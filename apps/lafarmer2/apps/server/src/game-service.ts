import { randomUUID } from "node:crypto";
import {
  getContentDefinition, ONLINE_COINS_PER_HOUR, OFFLINE_COINS_PER_HOUR,
  isKnownItemId, isWorldTileWalkable, ORIGIN_SHOP_OFFERS, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES, type ContentDefinition, type Quality
} from "@lafarmer2/content";
import type { Direction, FarmItem, FarmItemView, FarmStructure, FarmStructureType, MarketListing, MoveCommand, MoveResult, PlayerState, WalletEntry, WorldPresence, WorldSnapshot } from "./domain.js";
import type { FarmRepository, MarketRepository, PlayerRepository, StructureRepository, WalletRepository } from "./repositories.js";

const WORLD_BOUNDS = { minX: 0, maxX: WORLD_WIDTH_TILES - 1, minY: 0, maxY: WORLD_HEIGHT_TILES - 1 } as const;
const OFFLINE_CAP_SECONDS = 24 * 60 * 60;
const ONLINE_TICK_MS = 60_000;
const ONLINE_ACTIVITY_WINDOW_MS = 90_000;

export type GameRepositories = { players: PlayerRepository; farm: FarmRepository; structures: StructureRepository; market: MarketRepository; wallet: WalletRepository };

export class GameError extends Error {
  constructor(public readonly code: "player_not_found" | "invalid_action" | "invalid_direction" | "invalid_content" | "invalid_position" | "not_ready" | "insufficient_coins" | "insufficient_inputs" | "farm_item_not_found" | "listing_not_found" | "invalid_quantity" | "invalid_price" | "cannot_buy_own_listing" | "invalid_animal" | "inventory_full" | "invalid_quality" | "specialization_locked" | "structure_required" | "structure_full" | "invalid_structure" | "not_at_connection" | "region_not_found" | "not_neighbor") { super(code); }
}

type OfflineProgress = { coins: number; completedCycles: number; blockedByCapacity: number };

export class GameService {
  private readonly actionReceipts = new Map<string, MoveResult>();
  private readonly activePlayers = new Map<string, PlayerState>();
  private readonly pendingPersist = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onlineActivityUntil = new Map<string, number>();
  private readonly offlineProgress = new Map<string, OfflineProgress>();
  private readonly marketReceipts = new Map<string, { listing: MarketListing; coins: number; inventory: Record<string, number>; replayed: boolean }>();
  private marketQueue = Promise.resolve();

  constructor(private readonly repositories: GameRepositories, private readonly now: () => number = () => Date.now()) {}

  async snapshot(playerId: string): Promise<WorldSnapshot> {
    const player = await this.resume(playerId);
    const progress = await this.materializeOwner(player);
    const returnedProgress = this.offlineProgress.get(playerId) ?? { coins: 0, ...progress };
    this.offlineProgress.delete(playerId);
    const [persistedPlayers, farmItems, structures, listings] = await Promise.all([this.repositories.players.listAll(), this.repositories.farm.listAll(), this.repositories.structures.listAll(), this.repositories.market.listActive()]);
    const players = persistedPlayers.map((candidate) => this.activePlayers.get(candidate.id) ?? candidate);
    const regionId = player.currentRegionId ?? player.homeRegionId;
    return {
      bounds: WORLD_BOUNDS, player, players: players.filter((candidate) => candidate.id !== playerId && candidate.currentRegionId === regionId),
      farmItems: farmItems.filter((item) => item.regionId === regionId).map((item) => this.toView(item)), structures: structures.filter((structure) => structure.regionId === regionId), listings,
      presence: await this.worldPresence(),
      offlineProgress: returnedProgress
    };
  }

  async worldPresence(onlinePlayerIds: ReadonlySet<string> = new Set()): Promise<WorldPresence[]> {
    const persistedPlayers = await this.repositories.players.listAll();
    const players = persistedPlayers.map((candidate) => this.activePlayers.get(candidate.id) ?? candidate);
    return players.filter((candidate) => candidate.homeRegionId).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      farmName: candidate.farmName,
      homeRegionId: candidate.homeRegionId,
      currentRegionId: candidate.currentRegionId ?? candidate.homeRegionId,
      appearance: candidate.appearance,
      position: candidate.position,
      online: onlinePlayerIds.has(candidate.id)
    }));
  }

  async resume(playerId: string): Promise<PlayerState> {
    const player = await this.requirePlayer(playerId);
    const elapsedSeconds = Math.min(OFFLINE_CAP_SECONDS, Math.max(0, Math.floor((this.now() - player.lastActiveAt) / 1_000)));
    if (elapsedSeconds === 0) return player;
    const coins = Math.floor((elapsedSeconds * OFFLINE_COINS_PER_HOUR) / 3_600);
    const updated = { ...player, coins: player.coins + coins, lastActiveAt: this.now() };
    await this.savePlayer(updated);
    const progress = await this.materializeOwner(updated);
    this.offlineProgress.set(playerId, { coins, completedCycles: progress.completedCycles, blockedByCapacity: progress.blockedByCapacity });
    if (coins > 0) await this.recordWallet(updated, coins, "offline_reward", null);
    return updated;
  }

  markOnlineActivity(playerId: string): void { this.onlineActivityUntil.set(playerId, this.now() + ONLINE_ACTIVITY_WINDOW_MS); }

  async onlineTick(playerId: string): Promise<PlayerState> {
    const player = await this.requirePlayer(playerId);
    if ((this.onlineActivityUntil.get(playerId) ?? 0) < this.now()) return player;
    const coins = Math.floor((ONLINE_COINS_PER_HOUR * ONLINE_TICK_MS) / 3_600_000);
    const updated = { ...player, coins: player.coins + coins, lastActiveAt: this.now() };
    await this.savePlayer(updated);
    await this.recordWallet(updated, coins, "online_reward", null);
    return updated;
  }

  async wallet(playerId: string): Promise<WalletEntry[]> { return this.repositories.wallet.listByPlayerId(playerId); }

  async move(playerId: string, command: MoveCommand): Promise<MoveResult> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(command.actionId)) throw new GameError("invalid_action");
    if (!isDirection(command.direction)) throw new GameError("invalid_direction");
    const receiptKey = `${playerId}:${command.actionId}`;
    const previous = this.actionReceipts.get(receiptKey);
    if (previous) return previous;
    const player = await this.requirePlayer(playerId);
    let position = { x: Math.round(player.position.x), y: Math.round(player.position.y) };
    const regionId = player.currentRegionId ?? player.homeRegionId;
    const structures = await this.repositories.structures.listByOwnerId(playerId);
    const steps = command.sprint ? 2 : 1;
    let nextPosition = { ...position };
    for (let step = 0; step < steps; step += 1) {
      if (command.direction === "up") nextPosition.y -= 1;
      if (command.direction === "down") nextPosition.y += 1;
      if (command.direction === "left") nextPosition.x -= 1;
      if (command.direction === "right") nextPosition.x += 1;
      if (!isWorldTileWalkable(nextPosition.x, nextPosition.y) || structures.some((structure) => structure.regionId === regionId && insideStructureFootprint(structure, nextPosition.x, nextPosition.y))) {
        nextPosition = step === 0 ? { ...player.position } : { ...position };
        break;
      }
      position = { ...nextPosition };
    }
    const updated: PlayerState = { ...player, lastActiveAt: this.now(), position: nextPosition };
    await this.savePlayer(updated, false);
    const result: MoveResult = { actionId: command.actionId, accepted: true, player: updated };
    this.actionReceipts.set(receiptKey, result);
    return result;
  }

  async plant(playerId: string, input: { contentId: string; x?: number; y?: number }): Promise<FarmItemView> {
    const definition = getContentDefinition(input.contentId);
    if (!definition || definition.kind !== "crop") throw new GameError("invalid_content");
    const player = await this.requirePlayer(playerId);
    if (!player.specialization || definition.specialization !== player.specialization) throw new GameError("specialization_locked");
    await this.materializeOwner(player);
    const x = input.x ?? player.position.x;
    const y = input.y ?? player.position.y;
    if (!validPosition(x, y, player)) throw new GameError("invalid_position");
    const supplied = consumeInventory(player, definition.inputs[0]?.itemId, definition.inputs[0]?.quantity ?? 1);
    const item = createFarmItem(playerId, definition, this.now(), { x, y }, player.currentRegionId ?? player.homeRegionId ?? "region-center", null);
    await this.savePlayer({ ...supplied, lastActiveAt: this.now() });
    await this.repositories.farm.insert(item);
    return this.toView(item);
  }

  async adopt(playerId: string, input: { contentId: string; x?: number; y?: number }): Promise<FarmItemView> {
    const definition = getContentDefinition(input.contentId);
    if (!definition || (definition.kind !== "animal" && definition.kind !== "dinosaur")) throw new GameError("invalid_animal");
    const player = await this.requirePlayer(playerId);
    if (!player.specialization || definition.specialization !== player.specialization) throw new GameError("specialization_locked");
    const requiredType = requiredCreatureStructure(definition.id);
    if (!requiredType) throw new GameError("invalid_animal");
    await this.materializeOwner(player);
    const structures = await this.repositories.structures.listByOwnerId(playerId);
    const enclosure = structures.find((structure) => structure.regionId === (player.currentRegionId ?? player.homeRegionId) && structure.type === requiredType);
    if (!enclosure) throw new GameError("structure_required");
    const housed = (await this.repositories.farm.listByOwnerId(playerId)).filter((item) => item.structureId === enclosure.id).length;
    if (housed >= enclosure.capacity) throw new GameError("structure_full");
    const x = input.x ?? enclosure.position.x; const y = input.y ?? enclosure.position.y;
    if (!insideStructure(enclosure, x, y) || !isWorldTileWalkable(Math.round(x), Math.round(y))) throw new GameError("invalid_position");
    const sourceItem = adoptSourceItem(definition.id, player.inventory);
    if (!sourceItem) throw new GameError("insufficient_inputs");
    const supplied = consumeInventory(player, sourceItem, 1);
    const item = createFarmItem(playerId, definition, this.now(), { x, y }, enclosure.regionId, enclosure.id);
    await this.savePlayer({ ...supplied, lastActiveAt: this.now() });
    await this.repositories.farm.insert(item);
    return this.toView(item);
  }

  async buildStructure(playerId: string, input: { type: FarmStructureType; x?: number; y?: number }): Promise<FarmStructure> {
    const player = await this.requirePlayer(playerId);
    const costs: Record<FarmStructureType, { cost: number; width: number; height: number; capacity: number }> = {
      house: { cost: 0, width: 5, height: 3, capacity: 0 }, field: { cost: 100, width: 4, height: 3, capacity: 0 }, orchard: { cost: 150, width: 5, height: 4, capacity: 0 }, animal_pen: { cost: 300, width: 6, height: 5, capacity: 4 }, dinosaur_enclosure: { cost: 500, width: 8, height: 6, capacity: 3 }
    };
    const spec = costs[input.type];
    if (!spec) throw new GameError("invalid_structure");
    const regionId = player.currentRegionId ?? player.homeRegionId;
    if (!regionId) throw new GameError("region_not_found");
    const existing = await this.repositories.structures.listByOwnerId(playerId);
    const explicitPosition = input.x !== undefined || input.y !== undefined;
    const candidates = explicitPosition
      ? [{ x: Math.round(input.x ?? player.position.x), y: Math.round(input.y ?? player.position.y) }]
      : structureCandidates(player.position.x, player.position.y);
    const position = candidates.find((candidate) => {
      if (Math.abs(candidate.x - player.position.x) > 8 || Math.abs(candidate.y - player.position.y) > 8) return false;
      for (let yy = candidate.y; yy < candidate.y + spec.height; yy++) for (let xx = candidate.x; xx < candidate.x + spec.width; xx++) if (!isWorldTileWalkable(xx, yy)) return false;
      return !existing.some((structure) => structure.regionId === regionId && rectanglesOverlap(structure, candidate.x, candidate.y, spec.width, spec.height));
    });
    if (!position) throw new GameError(explicitPosition ? "invalid_position" : "invalid_structure");
    const { x, y } = position;
    if (player.coins < spec.cost) throw new GameError("insufficient_coins");
    const structure: FarmStructure = { id: randomUUID(), ownerId: playerId, regionId, type: input.type, footprint: [[x, y], [x + spec.width, y], [x + spec.width, y + spec.height], [x, y + spec.height]], capacity: spec.capacity, cost: spec.cost, state: "built", position: { x: x + Math.floor(spec.width / 2), y: y + Math.floor(spec.height / 2) } };
    await this.repositories.structures.insert(structure);
    if (spec.cost > 0) await this.debitCoins(player, spec.cost, "plant", structure.id);
    return structure;
  }

  async originOffers(playerId: string) {
    const player = await this.requirePlayer(playerId);
    return ORIGIN_SHOP_OFFERS.filter((offer) => offer.specialization === player.specialization);
  }

  async buyOriginOffer(playerId: string, offerId: string): Promise<{ offerId: string; inventory: Record<string, number>; coins: number }> {
    const player = await this.requirePlayer(playerId);
    const offer = ORIGIN_SHOP_OFFERS.find((candidate) => candidate.id === offerId);
    if (!offer || offer.specialization !== player.specialization) throw new GameError("specialization_locked");
    if (player.coins < offer.cost) throw new GameError("insufficient_coins");
    const updated = addInventory({ ...player, coins: player.coins - offer.cost }, offer.itemId, 1, "common");
    await this.savePlayer({ ...updated, lastActiveAt: this.now() });
    await this.recordWallet(updated, -offer.cost, "plant", offer.id);
    return { offerId, inventory: updated.inventory, coins: updated.coins };
  }

  async enterRegion(playerId: string, targetRegionId: string): Promise<PlayerState> {
    const player = await this.requirePlayer(playerId);
    const currentRegionId = player.currentRegionId ?? player.homeRegionId;
    if (!currentRegionId) throw new GameError("region_not_found");
    const target = (await this.repositories.players.listAll()).find((candidate) => candidate.homeRegionId === targetRegionId);
    if (!target) throw new GameError("region_not_found");
    const { getConnection } = await import("./world-service.js");
    const connection = getConnection(currentRegionId, targetRegionId);
    if (!connection) throw new GameError("not_neighbor");
    const outgoing = connection.fromRegionId === currentRegionId;
    const entry = outgoing ? connection.entry : connection.exit;
    const exit = outgoing ? connection.exit : connection.entry;
    if (Math.abs(player.position.x - entry.x) > 3 || Math.abs(player.position.y - entry.y) > 3) throw new GameError("not_at_connection");
    const updated = { ...player, currentRegionId: targetRegionId, position: { ...exit }, lastActiveAt: this.now() };
    await this.savePlayer(updated);
    return updated;
  }

  async care(playerId: string, itemId: string): Promise<FarmItemView> {
    const player = await this.requirePlayer(playerId);
    await this.materializeOwner(player);
    const item = await this.findOwnedItem(playerId, itemId);
    const definition = getContentDefinition(item.contentId);
    if (!definition?.capabilities.includes("care")) throw new GameError("invalid_content");
    const quality: Quality = item.quality === "good" ? "perfect" : "good";
    const updated = { ...item, lastCareAt: this.now(), careState: "attended" as const, quality, behaviorState: "happy" as const };
    await this.repositories.farm.update(updated);
    return this.toView(updated);
  }

  async harvest(playerId: string, itemId: string): Promise<{ item: FarmItemView; coins: number; inventory: Record<string, number>; quantity: number }> {
    const player = await this.requirePlayer(playerId);
    await this.materializeOwner(player);
    const item = await this.findOwnedItem(playerId, itemId);
    const definition = getContentDefinition(item.contentId);
    if (!definition || definition.kind !== "crop") throw new GameError("invalid_content");
    const view = this.toView(item);
    const quantity = item.pendingQuantity > 0 ? Math.min(item.pendingQuantity, freeInventorySlots(player)) : (view.ready ? definition.outputs[0]?.quantity ?? 1 : 0);
    if (!quantity) throw new GameError(view.ready ? "inventory_full" : "not_ready");
    const updatedPlayer = addInventory(player, definition.outputs[0].itemId, quantity, item.quality);
    if (definition.cycleSeconds === null) await this.repositories.farm.delete(item.id);
    else await this.repositories.farm.update({ ...item, pendingQuantity: item.pendingQuantity - quantity });
    await this.savePlayer({ ...updatedPlayer, lastActiveAt: this.now() });
    return { item: view, coins: updatedPlayer.coins, inventory: updatedPlayer.inventory, quantity };
  }

  async collect(playerId: string, itemId: string): Promise<{ item: FarmItemView; inventory: Record<string, number>; quantity: number }> {
    const player = await this.requirePlayer(playerId);
    await this.materializeOwner(player);
    const item = await this.findOwnedItem(playerId, itemId);
    const definition = getContentDefinition(item.contentId);
    if (!definition || (definition.kind !== "animal" && definition.kind !== "dinosaur")) throw new GameError("invalid_animal");
    if (item.pendingQuantity < 1) throw new GameError("not_ready");
    const quantity = Math.min(item.pendingQuantity, freeInventorySlots(player));
    if (!quantity) throw new GameError("inventory_full");
    const output = definition.outputs[0];
    const updatedPlayer = addInventory(player, output.itemId, quantity, item.quality);
    const updatedItem = { ...item, pendingQuantity: item.pendingQuantity - quantity, behaviorState: "produce" as const };
    await this.repositories.farm.update(updatedItem);
    await this.savePlayer({ ...updatedPlayer, lastActiveAt: this.now() });
    return { item: this.toView(updatedItem), inventory: updatedPlayer.inventory, quantity };
  }

  async createListing(playerId: string, input: { contentId: string; quantity: number; unitPrice: number; quality?: Quality }): Promise<MarketListing> {
    if (!isKnownItemId(input.contentId)) throw new GameError("invalid_content");
    if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new GameError("invalid_quantity");
    if (!Number.isInteger(input.unitPrice) || input.unitPrice < 1) throw new GameError("invalid_price");
    const player = await this.requirePlayer(playerId);
    if ((player.inventory[input.contentId] ?? 0) < input.quantity) throw new GameError("invalid_quantity");
    const quality = input.quality ?? pickAvailableQuality(player, input.contentId);
    if (input.quality && input.quality !== "common" && (player.inventoryQualities[input.contentId]?.[input.quality] ?? 0) < input.quantity) throw new GameError("invalid_quality");
    const inventory = removeInventory(player, input.contentId, input.quantity, quality);
    const listing: MarketListing = { id: randomUUID(), sellerId: playerId, sellerName: player.name, contentId: input.contentId, quantity: input.quantity, unitPrice: input.unitPrice, quality, createdAt: this.now() };
    await this.savePlayer({ ...inventory, lastActiveAt: this.now() });
    await this.repositories.market.insert(listing);
    return listing;
  }

  async buyListing(playerId: string, listingId: string, idempotencyKey?: string): Promise<{ listing: MarketListing; coins: number; inventory: Record<string, number>; replayed?: boolean }> {
    const receiptKey = idempotencyKey ? `${playerId}:${idempotencyKey}` : undefined;
    if (receiptKey && this.marketReceipts.has(receiptKey)) return { ...this.marketReceipts.get(receiptKey)!, replayed: true };
    const previous = this.marketQueue;
    let release!: () => void;
    this.marketQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (receiptKey && this.marketReceipts.has(receiptKey)) return { ...this.marketReceipts.get(receiptKey)!, replayed: true };
    const listing = await this.repositories.market.findById(listingId);
    if (!listing) throw new GameError("listing_not_found");
    if (listing.sellerId === playerId) throw new GameError("cannot_buy_own_listing");
    const [buyer, seller] = await Promise.all([this.requirePlayer(playerId), this.requirePlayer(listing.sellerId)]);
    if (freeInventorySlots(buyer) < listing.quantity) throw new GameError("inventory_full");
    const total = listing.quantity * listing.unitPrice;
    if (buyer.coins < total) throw new GameError("insufficient_coins");
    const buyerInventory = addInventory({ ...buyer, coins: buyer.coins - total }, listing.contentId, listing.quantity, listing.quality);
    await this.savePlayer({ ...buyerInventory, lastActiveAt: this.now() });
    await this.recordWallet({ ...buyerInventory, lastActiveAt: this.now() }, -total, "market_purchase", listing.id);
    const creditedSeller = { ...seller, coins: seller.coins + total, lastActiveAt: this.now() };
    await this.savePlayer(creditedSeller);
    await this.recordWallet(creditedSeller, total, "market_sale", listing.id);
    await this.repositories.market.delete(listing.id);
    const result = { listing, coins: buyerInventory.coins, inventory: buyerInventory.inventory, replayed: false };
    if (receiptKey) this.marketReceipts.set(receiptKey, result);
    return result;
    } finally { release(); }
  }

  private async materializeOwner(player: PlayerState): Promise<{ completedCycles: number; blockedByCapacity: number }> {
    const items = await this.repositories.farm.listByOwnerId(player.id);
    const inventoryUnits = inventoryCount(player.inventory);
    let pendingUnits = items.reduce((sum, item) => sum + item.pendingQuantity, 0);
    let completedCycles = 0; let blockedByCapacity = 0;
    for (const item of items) {
      const definition = getContentDefinition(item.contentId);
      if (!definition) continue;
      const otherPending = pendingUnits - item.pendingQuantity;
      const slots = Math.max(0, player.inventoryCapacity - inventoryUnits - otherPending - item.pendingQuantity);
      const result = materializeItem(item, definition, this.now(), slots);
      pendingUnits += result.item.pendingQuantity - item.pendingQuantity;
      completedCycles += result.completedCycles;
      blockedByCapacity += result.blocked ? 1 : 0;
      if (result.changed) await this.repositories.farm.update(result.item);
    }
    return { completedCycles, blockedByCapacity };
  }

  private async findOwnedItem(playerId: string, itemId: string): Promise<FarmItem> {
    const item = (await this.repositories.farm.listByOwnerId(playerId)).find((candidate) => candidate.id === itemId);
    if (!item) throw new GameError("farm_item_not_found");
    return item;
  }

  private async requirePlayer(playerId: string): Promise<PlayerState> {
    const active = this.activePlayers.get(playerId);
    if (active) return active;
    const player = await this.repositories.players.findById(playerId);
    if (!player) throw new GameError("player_not_found");
    const position = isWorldTileWalkable(Math.round(player.position.x), Math.round(player.position.y))
      ? { x: Math.round(player.position.x), y: Math.round(player.position.y) }
      : { x: 5, y: 5 };
    const normalized = position.x === player.position.x && position.y === player.position.y ? player : { ...player, position };
    this.activePlayers.set(playerId, normalized);
    if (normalized !== player) await this.repositories.players.update(normalized);
    return normalized;
  }

  private async debitCoins(player: PlayerState, amount: number, reason: WalletEntry["reason"], referenceId: string | null): Promise<PlayerState> {
    const updated = { ...player, coins: player.coins - amount, lastActiveAt: this.now() };
    await this.savePlayer(updated);
    await this.recordWallet(updated, -amount, reason, referenceId);
    return updated;
  }

  private async recordWallet(player: PlayerState, delta: number, reason: WalletEntry["reason"], referenceId: string | null): Promise<void> {
    await this.repositories.wallet.insert({ id: randomUUID(), playerId: player.id, delta, balance: player.coins, reason, referenceId, createdAt: this.now() });
  }

  private async savePlayer(player: PlayerState, immediate = true): Promise<void> {
    this.activePlayers.set(player.id, player);
    if (!immediate) {
      if (this.pendingPersist.has(player.id)) return;
      const timer = setTimeout(() => { this.pendingPersist.delete(player.id); const current = this.activePlayers.get(player.id); if (current) void this.repositories.players.update(current); }, 350);
      this.pendingPersist.set(player.id, timer);
      return;
    }
    const pending = this.pendingPersist.get(player.id);
    if (pending) { clearTimeout(pending); this.pendingPersist.delete(player.id); }
    await this.repositories.players.update(player);
  }

  private async flushPending(playerId: string): Promise<void> {
    const pending = this.pendingPersist.get(playerId);
    if (!pending) return;
    clearTimeout(pending);
    this.pendingPersist.delete(playerId);
    const current = this.activePlayers.get(playerId);
    if (current) await this.repositories.players.update(current);
  }

  private toView(item: FarmItem): FarmItemView {
    const definition = getContentDefinition(item.contentId);
    if (!definition) throw new GameError("invalid_content");
    const stage = stageAt(definition, item.plantedAt, this.now());
    const ready = item.pendingQuantity > 0 || (definition.cycleSeconds === null && stage.id === definition.stages.at(-1)?.id);
    const behaviorState = item.pendingQuantity > 0 && definition.kind !== "crop" ? "produce" : item.behaviorState;
    return { ...item, stageId: stage.id, visualKey: stage.visualKey, ready, behaviorState };
  }
}

export const ONLINE_TICK_INTERVAL_MS = ONLINE_TICK_MS;

function createFarmItem(ownerId: string, definition: ContentDefinition, now: number, position: { x: number; y: number }, regionId: string, structureId: string | null): FarmItem {
  const growthSeconds = definition.stages.slice(1).reduce((sum, stage) => sum + stage.durationSeconds, 0);
  return {
    id: randomUUID(), ownerId, contentId: definition.id, plantedAt: now, lastCareAt: null, lastProcessedAt: now,
    pendingQuantity: 0, nextProductionAt: definition.cycleSeconds === null ? null : now + growthSeconds * 1_000,
    quality: "common", careState: "awaiting-care", behaviorState: definition.behaviorProfile.initialState,
    appearanceVariantId: definition.visualVariants[0], regionId, structureId, position
  };
}

function materializeItem(item: FarmItem, definition: ContentDefinition, now: number, availableSlots: number): { item: FarmItem; completedCycles: number; blocked: boolean; changed: boolean } {
  if (definition.cycleSeconds === null || item.nextProductionAt === null) return { item, completedCycles: 0, blocked: false, changed: false };
  let pendingQuantity = item.pendingQuantity; let nextProductionAt = item.nextProductionAt; let lastProcessedAt = item.lastProcessedAt; let completedCycles = 0;
  const outputQuantity = definition.outputs[0]?.quantity ?? 1;
  let blocked = false;
  while (nextProductionAt <= now) {
    if (pendingQuantity + outputQuantity > item.pendingQuantity + availableSlots) {
      // Capacity pauses the producer at the current server time; missed cycles are not debt.
      blocked = true;
      nextProductionAt = now + definition.cycleSeconds * 1_000;
      lastProcessedAt = now;
      break;
    }
    pendingQuantity += outputQuantity;
    nextProductionAt += definition.cycleSeconds * 1_000;
    lastProcessedAt = nextProductionAt - definition.cycleSeconds * 1_000;
    completedCycles++;
  }
  const updated = { ...item, pendingQuantity, nextProductionAt, lastProcessedAt, behaviorState: pendingQuantity > item.pendingQuantity ? "produce" as const : item.behaviorState };
  return { item: updated, completedCycles, blocked, changed: pendingQuantity !== item.pendingQuantity || nextProductionAt !== item.nextProductionAt || lastProcessedAt !== item.lastProcessedAt };
}

function stageAt(definition: ContentDefinition, plantedAt: number, now: number) {
  let elapsed = Math.max(0, (now - plantedAt) / 1_000); let stage = definition.stages[0];
  for (const candidate of definition.stages.slice(1)) {
    if (elapsed < candidate.durationSeconds) break;
    elapsed -= candidate.durationSeconds; stage = candidate;
  }
  return stage;
}

function addInventory(player: PlayerState, itemId: string, quantity: number, quality: Quality): PlayerState {
  if (freeInventorySlots(player) < quantity) throw new GameError("inventory_full");
  const inventory = { ...player.inventory, [itemId]: (player.inventory[itemId] ?? 0) + quantity };
  const qualities = { ...player.inventoryQualities, [itemId]: { ...(player.inventoryQualities[itemId] ?? {}), [quality]: (player.inventoryQualities[itemId]?.[quality] ?? 0) + quantity } };
  return { ...player, inventory, inventoryQualities: qualities };
}

function removeInventory(player: PlayerState, itemId: string, quantity: number, quality: Quality): PlayerState {
  const available = player.inventory[itemId] ?? 0;
  if (available < quantity) throw new GameError("invalid_quantity");
  const inventory = { ...player.inventory, [itemId]: available - quantity };
  const qualityCounts = { ...(player.inventoryQualities[itemId] ?? {}) };
  const tracked = Object.values(qualityCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const fromQuality = Math.min(qualityCounts[quality] ?? 0, quantity);
  const untracked = Math.max(0, available - tracked);
  if (quality !== "common" && fromQuality < quantity) throw new GameError("invalid_quality");
  if (fromQuality) qualityCounts[quality] = (qualityCounts[quality] ?? 0) - fromQuality;
  if (fromQuality < quantity && quality === "common" && untracked < quantity - fromQuality) throw new GameError("invalid_quality");
  return { ...player, inventory, inventoryQualities: { ...player.inventoryQualities, [itemId]: qualityCounts } };
}

function pickAvailableQuality(player: PlayerState, itemId: string): Quality {
  const counts = player.inventoryQualities[itemId] ?? {};
  return (["perfect", "good", "common"] as Quality[]).find((quality) => (counts[quality] ?? 0) > 0) ?? "common";
}

function freeInventorySlots(player: PlayerState): number { return Math.max(0, player.inventoryCapacity - inventoryCount(player.inventory)); }
function inventoryCount(inventory: Record<string, number>): number { return Object.values(inventory).reduce((sum, quantity) => sum + quantity, 0); }
function structureCandidates(x: number, y: number): Array<{ x: number; y: number }> {
  const origin = { x: Math.round(x), y: Math.round(y) };
  const candidates = [origin];
  for (let radius = 1; radius <= 8; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        candidates.push({ x: origin.x + offsetX, y: origin.y + offsetY });
      }
    }
  }
  return candidates;
}
function validPosition(x: number, y: number, player: PlayerState): boolean { return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < WORLD_WIDTH_TILES && y >= 0 && y < WORLD_HEIGHT_TILES && Math.abs(x - player.position.x) <= 8 && Math.abs(y - player.position.y) <= 8 && isWorldTileWalkable(Math.round(x), Math.round(y)); }
function insideStructure(structure: FarmStructure, x: number, y: number): boolean {
  const xs = structure.footprint.map((point) => point[0]); const ys = structure.footprint.map((point) => point[1]);
  return x >= Math.min(...xs) + 1 && x < Math.max(...xs) - 1 && y >= Math.min(...ys) + 1 && y < Math.max(...ys) - 1;
}

function consumeInventory(player: PlayerState, itemId: string | undefined, quantity: number): PlayerState {
  if (!itemId || (player.inventory[itemId] ?? 0) < quantity) throw new GameError("insufficient_inputs");
  return removeInventory(player, itemId, quantity, "common");
}
function rectanglesOverlap(structure: FarmStructure, x: number, y: number, width: number, height: number): boolean {
  const xs = structure.footprint.map((point) => point[0]); const ys = structure.footprint.map((point) => point[1]);
  return x < Math.max(...xs) && x + width > Math.min(...xs) && y < Math.max(...ys) && y + height > Math.min(...ys);
}
function insideStructureFootprint(structure: FarmStructure, x: number, y: number): boolean {
  const xs = structure.footprint.map((point) => point[0]); const ys = structure.footprint.map((point) => point[1]);
  return x >= Math.min(...xs) && x < Math.max(...xs) && y >= Math.min(...ys) && y < Math.max(...ys);
}
function requiredCreatureStructure(contentId: string): FarmStructureType | undefined {
  if (contentId === "dinosaur") return "dinosaur_enclosure";
  if (contentId === "cow") return "animal_pen";
  return undefined;
}

function adoptSourceItem(contentId: string, inventory: Record<string, number>): string | null {
  if (contentId === "cow") return (inventory.feed ?? 0) > 0 ? "feed" : null;
  if (contentId === "dinosaur") return (inventory["dinosaur-egg"] ?? 0) > 0 ? "dinosaur-egg" : (inventory["dinosaur-fossil"] ?? 0) > 0 ? "dinosaur-fossil" : null;
  return null;
}

function isDirection(value: string): value is Direction { return value === "up" || value === "down" || value === "left" || value === "right"; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

function asGameError(error: unknown): Error {
  const code = error instanceof Error ? error.message : "";
  const codes: GameError["code"][] = ["player_not_found", "invalid_quantity", "listing_not_found", "cannot_buy_own_listing", "insufficient_coins"];
  return codes.includes(code as GameError["code"]) ? new GameError(code as GameError["code"]) : error instanceof Error ? error : new Error("market_failed");
}
