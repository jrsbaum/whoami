import {
  MARKET_TILE,
  PLAYER_SPAWN,
  WORLD_CONNECTIONS,
  getWorldRegion,
  isWorldTileWalkable,
  type Clothing,
  type HairStyle
} from "@lafarmer2/content";
import * as THREE from "three";
import type { RealtimeClient, WorldPresence } from "../network";
import { createFarmItemMesh, createFarmer, createStructureMesh, poseActor } from "./actors";
import { TILE, sampleHeight, tileToWorld, worldToTile } from "./height";
import {
  INITIAL_CAMERA_YAW,
  SPRINT_TILES_PER_SECOND,
  WALK_TILES_PER_SECOND,
  chooseWalk,
  directionFromYaw,
  forwardFromYaw,
  type PlanarInput
} from "./movement";
import { createValley, type Valley } from "./valley";

const STEP_LEAD = TILE * 0.5;

export type Direction = "up" | "down" | "left" | "right";

export type WorldCallbacks = {
  realtime: RealtimeClient;
  appearance: { clothing: Clothing; hair: HairStyle };
  name: string;
  inventory: Record<string, number>;
  onCoins: (coins: number) => void;
  onInventory: (inventory: Record<string, number>, qualities?: Record<string, Partial<Record<string, number>>>) => void;
  onProduction: (ready: number, total: number) => void;
  onPresence: (presence: WorldPresence[]) => void;
  onSnapshot: (snapshot: Record<string, unknown>) => void;
  onMarket: () => void;
  onConnectionPrompt: (message: string) => void;
  onMessage: (text: string) => void;
  onTime?: (label: string) => void;
};

type FarmView = { id: string; contentId: string; ready: boolean; visualKey: string; mesh: THREE.Group; tileX: number; tileY: number };

export class WorldView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly root: HTMLElement;
  private readonly callbacks: WorldCallbacks;
  private readonly player: THREE.Group;
  private readonly keys = new Set<string>();
  private readonly pendingMoves = new Map<string, Direction>();
  private readonly remotes = new Map<string, THREE.Group>();
  private readonly farmItems = new Map<string, FarmView>();
  private readonly structures = new Map<string, THREE.Group>();
  private facing: Direction = "right";
  private tile: { x: number; y: number } = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y };
  private display = new THREE.Vector3();
  private lastMoveAt = 0;
  private lastBlockedAt = 0;
  private stuck = false;
  private preferCrossAxis = false;
  private gait: "walk" | "sprint" = "walk";
  private cameraYaw = INITIAL_CAMERA_YAW;
  private cameraSnapped = false;
  private dragging = false;
  private dragX = 0;
  private lastFrame = performance.now();
  private lastRegionEntryAt = 0;
  private lastPrompt = "";
  private currentRegionId = "";
  private knownPresence: WorldPresence[] = [];
  private touchDirection: Direction | undefined;
  private raf = 0;
  private disposed = false;
  private unbindRealtime: (() => void) | undefined;
  private readonly valley: Valley;
  private readonly cameraAim = new THREE.Vector3();
  private readonly cameraGoal = new THREE.Vector3();
  private readonly cameraRay = new THREE.Raycaster();
  private lastTimeLabel = "";

  constructor(root: HTMLElement, callbacks: WorldCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.valley = createValley(this.scene);
    this.player = createFarmer(callbacks.appearance.clothing, callbacks.appearance.hair);
    this.player.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true; });
    this.player.rotation.y = INITIAL_CAMERA_YAW;
    this.scene.add(this.player);
    this.setTile(PLAYER_SPAWN.x, PLAYER_SPAWN.y, true);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    root.append(this.renderer.domElement);
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.handlePointerUp);
    this.renderer.domElement.addEventListener("contextmenu", this.blockContextMenu);
    this.bindTouch();
    this.unbindRealtime = callbacks.realtime.onMessage((message) => this.handleMessage(message));
    this.tick();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("contextmenu", this.blockContextMenu);
    this.unbindRealtime?.();
    this.valley.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setInventory(inventory: Record<string, number>): void {
    this.callbacks.inventory = inventory;
  }

  applyStructure(structure: { id: string; type: string; footprint: Array<[number, number]> }): void {
    this.renderStructure(structure);
  }

  applyAppearance(clothing: Clothing, hair: HairStyle): void {
    this.scene.remove(this.player);
    const next = createFarmer(clothing, hair);
    next.position.copy(this.player.position);
    this.player.clear();
    this.player.add(...next.children);
    this.player.userData.limbs = next.userData.limbs;
    this.player.userData.animate = "walk";
  }

  private handleResize = (): void => {
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (event.repeat && key === "e") return;
    if (key === " " || key.startsWith("arrow")) event.preventDefault();
    this.keys.add(key);
    if (key === "e") this.interact();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private blockContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.dragging = true;
    this.dragX = event.clientX;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = event.clientX - this.dragX;
    this.dragX = event.clientX;
    this.cameraYaw -= dx * 0.005;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
  };

  private bindTouch(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-direction]").forEach((button) => {
      const direction = button.dataset.direction as Direction;
      const start = (event: Event) => { event.preventDefault(); this.touchDirection = direction; };
      const stop = () => { if (this.touchDirection === direction) this.touchDirection = undefined; };
      button.addEventListener("pointerdown", start, { passive: false });
      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("pointerleave", stop);
    });
  }

  private tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.keys.has("q")) this.cameraYaw += 2.2 * dt;
    this.facing = directionFromYaw(this.cameraYaw);
    const input = this.moveInput();
    const sprint = this.keys.has(" ") || this.keys.has("space");
    const remain = Math.hypot(this.display.x - this.player.position.x, this.display.z - this.player.position.z);
    const retry = this.stuck ? 320 : 70;
    if (input && this.pendingMoves.size < 2 && remain <= STEP_LEAD && now - this.lastMoveAt >= retry) {
      this.lastMoveAt = now;
      this.stuck = !this.tryMove(input, sprint);
    }
    this.slidePlayer(dt);
    this.turnPlayer(dt);
    const moving = Math.hypot(this.display.x - this.player.position.x, this.display.z - this.player.position.z) > 0.04 || Boolean(input);
    poseActor(this.player, now, moving);
    this.farmItems.forEach((item) => poseActor(item.mesh, now, false));
    this.remotes.forEach((remote) => poseActor(remote, now, true));
    this.followCamera(dt);
    const phase = this.valley.update(now, this.player.position, this.renderer, this.scene, this.camera);
    if (phase.name !== this.lastTimeLabel) {
      this.lastTimeLabel = phase.name;
      this.callbacks.onTime?.(phase.name);
    }
    this.updateConnectionPrompt();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  private moveInput(): PlanarInput | undefined {
    let forward = 0;
    let strafe = 0;
    const touch = this.touchDirection;
    if (touch === "up" || this.keys.has("w") || this.keys.has("arrowup")) forward += 1;
    if (touch === "down" || this.keys.has("s") || this.keys.has("arrowdown")) forward -= 1;
    if (touch === "right" || this.keys.has("d") || this.keys.has("arrowright")) strafe += 1;
    if (touch === "left" || this.keys.has("a") || this.keys.has("arrowleft")) strafe -= 1;
    const length = Math.hypot(forward, strafe);
    if (length < 0.01) return undefined;
    return { forward: forward / length, strafe: strafe / length };
  }

  private tryMove(input: PlanarInput, sprint: boolean): boolean {
    const choice = chooseWalk(this.tile, this.cameraYaw, input, this.preferCrossAxis, isWorldTileWalkable, sprint);
    if (!choice) {
      if (performance.now() - this.lastBlockedAt > 700) {
        this.lastBlockedAt = performance.now();
        this.callbacks.onMessage("Água, árvore ou prédio bloqueia esse passo.");
      }
      return false;
    }
    const steps = Math.abs(choice.x - this.tile.x) + Math.abs(choice.y - this.tile.y);
    const actionId = this.callbacks.realtime.move(choice.direction, sprint && steps === 2);
    if (!actionId) return false;
    this.pendingMoves.set(actionId, choice.direction);
    this.preferCrossAxis = !this.preferCrossAxis;
    this.gait = sprint && steps === 2 ? "sprint" : "walk";
    this.setTile(choice.x, choice.y, false);
    return true;
  }

  private slidePlayer(dt: number): void {
    const tilesPerSecond = this.gait === "sprint" ? SPRINT_TILES_PER_SECOND : WALK_TILES_PER_SECOND;
    const dx = this.display.x - this.player.position.x;
    const dz = this.display.z - this.player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.0001) {
      const step = Math.min(distance, tilesPerSecond * TILE * dt);
      this.player.position.x += (dx / distance) * step;
      this.player.position.z += (dz / distance) * step;
    }
    const foot = worldToTile(this.player.position.x, this.player.position.z);
    this.player.position.y = sampleHeight(foot.x, foot.y);
  }

  private turnPlayer(dt: number): void {
    const delta = Math.atan2(Math.sin(this.cameraYaw - this.player.rotation.y), Math.cos(this.cameraYaw - this.player.rotation.y));
    this.player.rotation.y += delta * (1 - Math.exp(-12 * dt));
  }

  private stepFrom(origin: { x: number; y: number }, direction: Direction, steps: number): { x: number; y: number } {
    const next = { ...origin };
    for (let step = 0; step < steps; step += 1) {
      const candidate = { ...next };
      if (direction === "right") candidate.x += 1;
      if (direction === "left") candidate.x -= 1;
      if (direction === "down") candidate.y += 1;
      if (direction === "up") candidate.y -= 1;
      if (!isWorldTileWalkable(candidate.x, candidate.y)) break;
      next.x = candidate.x;
      next.y = candidate.y;
    }
    return next;
  }

  private setTile(x: number, y: number, snap: boolean): void {
    this.tile = { x, y };
    const point = tileToWorld(x, y);
    this.display.set(point.x, point.y, point.z);
    if (snap) {
      this.player.position.copy(this.display);
      this.cameraSnapped = false;
    }
  }

  private followCamera(dt: number): void {
    const forward = forwardFromYaw(this.cameraYaw);
    const distance = 6.8;
    const height = 3.35;
    const origin = this.player.position.clone();
    origin.y += 1.45;
    this.cameraGoal.set(
      this.player.position.x - forward.x * distance,
      this.player.position.y + height,
      this.player.position.z - forward.z * distance
    );
    this.liftCamera(this.cameraGoal);
    const toCamera = this.cameraGoal.clone().sub(origin);
    const span = toCamera.length();
    if (span > 0.001) {
      this.cameraRay.near = 0.2;
      this.cameraRay.far = span;
      this.cameraRay.set(origin, toCamera.normalize());
      const hit = this.cameraRay.intersectObject(this.valley.terrain, false)[0];
      if (hit && hit.distance < span - 0.35) {
        this.cameraGoal.copy(origin).addScaledVector(toCamera, Math.max(2.8, hit.distance - 0.4));
        this.liftCamera(this.cameraGoal);
      }
    }
    const blend = this.cameraSnapped ? 1 - Math.exp(-10 * dt) : 1;
    this.camera.position.lerp(this.cameraGoal, blend);
    this.liftCamera(this.camera.position);
    this.cameraSnapped = true;
    const look = origin.clone();
    look.x += forward.x * 1.35;
    look.z += forward.z * 1.35;
    look.y = this.player.position.y + 1.15;
    this.cameraAim.lerp(look, blend);
    this.camera.lookAt(this.cameraAim);
  }

  private liftCamera(point: THREE.Vector3): void {
    const tile = worldToTile(point.x, point.z);
    const floor = sampleHeight(tile.x, tile.y);
    if (point.y < floor + 0.9) point.y = floor + 0.9;
  }

  private frontTile(): { x: number; y: number } {
    return this.stepFrom(this.tile, this.facing, 1);
  }

  private interact(): void {
    const connection = this.nearbyConnection();
    if (connection && this.lastRegionEntryAt + 1_000 < performance.now()) {
      const targetId = connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId;
      this.lastRegionEntryAt = performance.now();
      this.callbacks.realtime.enterRegion(targetId);
      return;
    }
    const nearest = [...this.farmItems.values()].sort((a, b) => this.tileDistance(a.tileX, a.tileY) - this.tileDistance(b.tileX, b.tileY))[0];
    if (nearest && this.tileDistance(nearest.tileX, nearest.tileY) <= 2) {
      const action = nearest.contentId === "cow" || nearest.contentId === "dinosaur"
        ? (nearest.ready ? "farm.collect" : "farm.care")
        : (nearest.ready ? "farm.harvest" : "farm.care");
      this.callbacks.realtime.action(action, { itemId: nearest.id });
      return;
    }
    if (this.nearMarket()) {
      this.callbacks.onMarket();
      return;
    }
    const front = this.frontTile();
    const plantId = this.plantableContent();
    if (plantId) {
      this.callbacks.realtime.action("farm.plant", { contentId: plantId, x: front.x, y: front.y });
      this.callbacks.onMessage("Plantando no tile à frente.");
      return;
    }
    const adoptId = this.adoptableContent();
    if (adoptId) {
      this.callbacks.realtime.action("farm.adopt", { contentId: adoptId, x: this.tile.x, y: this.tile.y });
      this.callbacks.onMessage(adoptId === "cow" ? "Adotando a vaca no curral." : "Adotando o dinossauro no recinto.");
      return;
    }
    this.callbacks.onMessage("Nada para fazer aqui. Chegue a uma planta, criatura, porteira ou ao mercadinho.");
  }

  private plantableContent(): string | undefined {
    if ((this.callbacks.inventory["tomato-seed"] ?? 0) > 0) return "tomato";
    if ((this.callbacks.inventory["orange-seed"] ?? 0) > 0) return "orange-tree";
    return undefined;
  }

  private adoptableContent(): string | undefined {
    if ((this.callbacks.inventory.feed ?? 0) > 0) return "cow";
    if ((this.callbacks.inventory["dinosaur-egg"] ?? 0) > 0 || (this.callbacks.inventory["dinosaur-fossil"] ?? 0) > 0) return "dinosaur";
    return undefined;
  }

  private nearMarket(): boolean {
    const centerX = MARKET_TILE.x + MARKET_TILE.width / 2;
    const centerY = MARKET_TILE.y + MARKET_TILE.height / 2;
    return Math.abs(this.tile.x - centerX) <= 4 && Math.abs(this.tile.y - centerY) <= 4;
  }

  private tileDistance(x: number, y: number): number {
    return Math.abs(this.tile.x - x) + Math.abs(this.tile.y - y);
  }

  private nearbyConnection(): (typeof WORLD_CONNECTIONS)[number] | undefined {
    return WORLD_CONNECTIONS.find((connection) => {
      const outgoing = connection.fromRegionId === this.currentRegionId;
      if (!outgoing && connection.toRegionId !== this.currentRegionId) return false;
      const targetId = outgoing ? connection.toRegionId : connection.fromRegionId;
      if (!this.knownPresence.some((presence) => presence.homeRegionId === targetId)) return false;
      const point = outgoing ? connection.entry : connection.exit;
      return this.tileDistance(point.x, point.y) <= 3;
    });
  }

  private updateConnectionPrompt(): void {
    const connection = this.nearbyConnection();
    const targetId = connection ? (connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId) : "";
    const target = targetId ? getWorldRegion(targetId) : undefined;
    const marketHint = this.nearMarket() ? "Mercadinho do vale · pressione E para negociar." : "";
    const message = target
      ? `${connection?.kind === "bridge" ? "Ponte" : connection?.kind === "gate" ? "Porteira" : "Passagem"} para ${target.name} · pressione E para visitar.`
      : marketHint;
    if (message !== this.lastPrompt) {
      this.lastPrompt = message;
      this.callbacks.onConnectionPrompt(message);
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.type === "wallet.updated") {
      const payload = message.payload as { coins?: number; inventory?: Record<string, number> } | undefined;
      if (typeof payload?.coins === "number") this.callbacks.onCoins(payload.coins);
      if (payload?.inventory) this.callbacks.onInventory(payload.inventory);
    }
    if (message.type === "farm.harvested") {
      const payload = message as { inventory?: Record<string, number>; item?: { id?: string } };
      if (payload.inventory) this.callbacks.onInventory(payload.inventory);
      if (payload.item?.id) this.removeFarmItem(payload.item.id);
    }
    if (message.type === "farm.collected") {
      const payload = message as { inventory?: Record<string, number>; item?: Record<string, unknown> };
      if (payload.inventory) this.callbacks.onInventory(payload.inventory);
      if (payload.item) this.renderFarmItem(payload.item);
    }
    if (message.type === "farm.updated") {
      const item = message.item as Record<string, unknown> | undefined;
      if (item) this.renderFarmItem(item);
    }
    if (message.type === "hello" || message.type === "snapshot") this.applySnapshot(message.snapshot as Record<string, unknown>);
    if (message.type === "world.presence") {
      const presence = message.presence as WorldPresence[] | undefined;
      if (presence) { this.knownPresence = presence; this.callbacks.onPresence(presence); }
    }
    if (message.type === "world.region.entered") {
      const player = message.player as Record<string, unknown> | undefined;
      if (player) {
        this.currentRegionId = String(player.currentRegionId ?? player.homeRegionId ?? this.currentRegionId);
        const position = player.position as { x?: number; y?: number } | undefined;
        if (typeof position?.x === "number" && typeof position.y === "number") this.setTile(position.x, position.y, true);
        this.callbacks.realtime.requestSnapshot();
      }
    }
    if (message.type === "player_joined" || message.type === "player_moved" || message.type === "player_region_changed") {
      const player = (message.player ?? message) as Record<string, unknown>;
      const id = String((message as { playerId?: string }).playerId ?? player.id ?? "");
      if (id) this.renderRemote(player, id);
    }
    if (message.type === "player_left" && typeof message.playerId === "string") this.removeRemote(message.playerId);
    if (message.type === "move_ack") {
      const position = (message.player as { position?: { x: number; y: number } } | undefined)?.position;
      if (position) this.reconcile(position.x, position.y, typeof message.actionId === "string" ? message.actionId : undefined);
    }
  }

  private applySnapshot(snapshot: Record<string, unknown>): void {
    this.farmItems.forEach((item) => item.mesh.removeFromParent());
    this.farmItems.clear();
    this.structures.forEach((mesh) => mesh.removeFromParent());
    this.structures.clear();
    this.remotes.forEach((mesh) => mesh.removeFromParent());
    this.remotes.clear();
    const player = snapshot.player as { coins?: number; inventory?: Record<string, number>; inventoryQualities?: Record<string, Partial<Record<string, number>>>; position?: { x?: number; y?: number }; currentRegionId?: string | null; homeRegionId?: string | null } | undefined;
    if (typeof player?.coins === "number") this.callbacks.onCoins(player.coins);
    if (player?.inventory) this.callbacks.onInventory(player.inventory, player.inventoryQualities);
    if (typeof player?.position?.x === "number" && typeof player.position.y === "number") this.setTile(player.position.x, player.position.y, true);
    this.currentRegionId = player?.currentRegionId ?? player?.homeRegionId ?? this.currentRegionId;
    const presence = snapshot.presence as WorldPresence[] | undefined;
    if (presence) { this.knownPresence = presence; this.callbacks.onPresence(presence); }
    this.callbacks.onSnapshot(snapshot);
    const offline = snapshot.offlineProgress as { coins?: number } | undefined;
    if (offline?.coins) this.callbacks.onMessage(`Recompensa offline: +${offline.coins} moedas.`);
    (snapshot.farmItems as Array<Record<string, unknown>> | undefined)?.forEach((item) => this.renderFarmItem(item));
    (snapshot.structures as Array<Record<string, unknown>> | undefined)?.forEach((structure) => this.renderStructure(structure));
    (snapshot.players as Array<Record<string, unknown>> | undefined)?.forEach((remote) => this.renderRemote(remote, String(remote.id ?? "")));
    this.notifyFarm();
  }

  private reconcile(x: number, y: number, actionId?: string): void {
    if (actionId) this.pendingMoves.delete(actionId);
    const drift = Math.abs(this.tile.x - x) + Math.abs(this.tile.y - y);
    if (drift > this.pendingMoves.size) this.setTile(x, y, drift > 2);
  }

  private renderFarmItem(item: Record<string, unknown>): void {
    const id = String(item.id ?? "");
    if (!id) return;
    this.removeFarmItem(id);
    const position = item.position as { x?: number; y?: number } | undefined;
    const tileX = Number(position?.x ?? 0);
    const tileY = Number(position?.y ?? 0);
    const contentId = String(item.contentId ?? "tomato");
    const visualKey = String(item.visualKey ?? contentId);
    const ready = Boolean(item.ready);
    const mesh = createFarmItemMesh(visualKey, contentId, ready, tileX, tileY);
    this.scene.add(mesh);
    this.farmItems.set(id, { id, contentId, ready, visualKey, mesh, tileX, tileY });
    this.notifyFarm();
  }

  private renderStructure(raw: Record<string, unknown>): void {
    const id = String(raw.id ?? "");
    const footprint = raw.footprint as Array<[number, number]> | undefined;
    if (!id || !footprint?.length) return;
    this.structures.get(id)?.removeFromParent();
    const mesh = createStructureMesh(String(raw.type ?? "field"), footprint);
    this.scene.add(mesh);
    this.structures.set(id, mesh);
  }

  private renderRemote(raw: Record<string, unknown>, forcedId: string): void {
    const id = forcedId || String(raw.id ?? "");
    if (!id) return;
    const position = raw.position as { x?: number; y?: number } | undefined;
    const appearance = raw.appearance as { clothing?: Clothing; hair?: HairStyle } | undefined;
    if (typeof position?.x !== "number" || typeof position.y !== "number") return;
    this.removeRemote(id);
    const mesh = createFarmer(appearance?.clothing ?? "forest", appearance?.hair ?? "short");
    const point = tileToWorld(position.x, position.y);
    mesh.position.set(point.x, point.y, point.z);
    this.scene.add(mesh);
    this.remotes.set(id, mesh);
  }

  private removeFarmItem(id: string): void {
    const item = this.farmItems.get(id);
    if (!item) return;
    item.mesh.removeFromParent();
    this.farmItems.delete(id);
    this.notifyFarm();
  }

  private removeRemote(id: string): void {
    this.remotes.get(id)?.removeFromParent();
    this.remotes.delete(id);
  }

  private notifyFarm(): void {
    const ready = [...this.farmItems.values()].filter((item) => item.ready).length;
    this.callbacks.onProduction(ready, this.farmItems.size);
  }
}
