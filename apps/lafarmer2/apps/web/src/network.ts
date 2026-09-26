import type { Clothing, HairStyle, Quality, Specialization } from "@lafarmer2/content";

export interface PlayerProfile {
  nick: string;
  name: string;
  farmName: string;
  specialization: Specialization | null;
  plotId: string;
  outfit: Clothing;
  hair: HairStyle;
}

export type LandOption = {
  id: string;
  regionId: string;
  biome: string;
  title: string;
  feature: string;
  summary: string;
  fertility: number;
  nearbyNeighbors: number;
  connectionId: string | null;
};

export type WorldOverviewRegion = {
  id: string;
  name: string;
  biome: string;
  feature: string;
  summary: string;
  fertility: number;
  neighbors: readonly string[];
  connectionId: string | null;
  status: "occupied" | "frontier" | "locked";
  occupiedBy: string | null;
};

export type WorldPresence = {
  id: string;
  name: string;
  farmName: string;
  homeRegionId: string | null;
  currentRegionId: string | null;
  appearance: { clothing: Clothing; hair: HairStyle };
  position: { x: number; y: number };
  online: boolean;
};

export type ServerPlayer = {
  id: string;
  name: string;
  farmName: string;
  specialization: Specialization | null;
  plot: { id?: string } | null;
  homeRegionId?: string | null;
  currentRegionId?: string | null;
  coins: number;
  appearance: { clothing: Clothing; hair: HairStyle };
  position?: { x: number; y: number };
  inventory?: Record<string, number>;
  inventoryQualities?: Record<string, Partial<Record<Quality, number>>>;
};

export type AuthResult = { token: string; player: ServerPlayer; credentials: { nick: string } };
export type OriginOffer = { id: string; displayName: string; itemId: string; specialization: Specialization; cost: number; kind: string };
export type MarketListing = { id: string; sellerId: string; sellerName: string; contentId: string; quantity: number; unitPrice: number; quality?: Quality; createdAt: number };
export type WalletEntry = { id: string; delta: number; balance: number; reason: string; createdAt: number };
export type FarmStructure = { id: string; type: string; footprint: Array<[number, number]>; position: { x: number; y: number }; regionId: string };

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : window.location.origin);

const api = async <T>(path: string, init: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (body as { error?: string }).error === "string" ? (body as { error: string }).error : "request_failed");
  return body as T;
};

export const register = (nick: string, password: string): Promise<AuthResult> =>
  api<AuthResult>("/api/auth/register", { method: "POST", body: JSON.stringify({ nick, password, credentialsSaved: true }) });

export const login = (nick: string, password: string): Promise<AuthResult> =>
  api<AuthResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ nick, password }) });

export const getMe = (token: string): Promise<{ player: ServerPlayer }> =>
  api<{ player: ServerPlayer }>("/api/me", { method: "GET", headers: { authorization: `Bearer ${token}` } });

export const getLandOptions = (token: string): Promise<{ options: LandOption[] }> =>
  api<{ options: LandOption[] }>("/api/world/land-options", { method: "GET", headers: { authorization: `Bearer ${token}` } });

export const getWorldOverview = (token: string): Promise<{ regions: WorldOverviewRegion[] }> =>
  api<{ regions: WorldOverviewRegion[] }>("/api/world/overview", { method: "GET", headers: { authorization: `Bearer ${token}` } });

export const reserveRegion = (token: string, regionId: string): Promise<{ regionId: string; expiresAt: number }> =>
  api<{ regionId: string; expiresAt: number }>("/api/world/region/reserve", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ regionId }) });

export const getOriginShop = (token: string): Promise<{ offers: OriginOffer[] }> =>
  api<{ offers: OriginOffer[] }>("/api/shop/origin", { method: "GET", headers: { authorization: `Bearer ${token}` } });

export const buyOriginOffer = (token: string, offerId: string): Promise<{ offerId: string; inventory: Record<string, number>; coins: number }> =>
  api<{ offerId: string; inventory: Record<string, number>; coins: number }>(`/api/shop/origin/${encodeURIComponent(offerId)}/buy`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });

export const buildStructure = (token: string, type: string): Promise<{ structure: FarmStructure }> =>
  api<{ structure: FarmStructure }>("/api/farm/structures", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type }) });

export const updateProfile = (token: string, profile: Pick<PlayerProfile, "name" | "farmName" | "specialization" | "plotId" | "outfit" | "hair">): Promise<{ player: ServerPlayer }> =>
  api<{ player: ServerPlayer }>("/api/player/profile", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: profile.name, farmName: profile.farmName, specialization: profile.specialization, plotId: profile.plotId, clothing: profile.outfit, hair: profile.hair })
  });

export const updateAppearance = (token: string, name: string, clothing: Clothing, hair: HairStyle): Promise<{ player: ServerPlayer }> =>
  api<{ player: ServerPlayer }>("/api/player/profile", { method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ name, clothing, hair }) });

export const getMarket = (): Promise<{ listings: MarketListing[] }> => api<{ listings: MarketListing[] }>("/api/market", { method: "GET" });

export const createListing = (token: string, contentId: string, quantity: number, unitPrice: number, quality?: Quality): Promise<{ listing: MarketListing }> =>
  api<{ listing: MarketListing }>("/api/market/listings", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ contentId, quantity, unitPrice, quality }) });

export const buyListing = (token: string, listingId: string, idempotencyKey = crypto.randomUUID()): Promise<{ coins: number; inventory: Record<string, number>; replayed: boolean }> =>
  api<{ coins: number; inventory: Record<string, number>; replayed: boolean }>(`/api/market/${encodeURIComponent(listingId)}/buy`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: "{}"
  });

export const getWallet = (token: string): Promise<{ entries: WalletEntry[] }> =>
  api<{ entries: WalletEntry[] }>("/api/wallet", { method: "GET", headers: { authorization: `Bearer ${token}` } });

export type RealtimeStatus = "offline-demo" | "connecting" | "reconnecting" | "connected";
type MessageHandler = (message: Record<string, unknown>) => void;

export class RealtimeClient {
  readonly url: string;
  status: RealtimeStatus = "offline-demo";
  private socket: WebSocket | undefined;
  private handlers = new Set<MessageHandler>();
  private readonly moveSentAt = new Map<string, number>();
  private token = "";
  private retryTimer: number | undefined;
  private retryAttempt = 0;
  private closedByUser = false;
  private initialConnectionResolve: ((status: RealtimeStatus) => void) | undefined;
  latencyMs = 0;

  constructor(url = import.meta.env.VITE_WS_URL || (import.meta.env.DEV ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws` : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`)) {
    this.url = url;
  }

  async connect(token: string): Promise<RealtimeStatus> {
    this.close();
    if (!this.url || !token) { this.status = "offline-demo"; return this.status; }
    this.closedByUser = false;
    this.token = token;
    this.retryAttempt = 0;
    this.status = "connecting";
    return new Promise((resolve) => {
      this.initialConnectionResolve = resolve;
      this.openSocket();
      window.setTimeout(() => {
        if (!this.initialConnectionResolve) return;
        this.initialConnectionResolve = undefined;
        this.status = "offline-demo";
        resolve("offline-demo");
        this.scheduleReconnect();
      }, 1600);
    });
  }

  private openSocket(): void {
    if (this.closedByUser || !this.url || !this.token) return;
    try {
      const socket = new WebSocket(`${this.url}?token=${encodeURIComponent(this.token)}`);
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (this.retryTimer !== undefined) { window.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
        this.retryAttempt = 0;
        this.status = "connected";
        const resolve = this.initialConnectionResolve;
        this.initialConnectionResolve = undefined;
        resolve?.("connected");
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        if (!this.closedByUser) this.scheduleReconnect();
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === "move_ack" && typeof message.actionId === "string") {
            const sentAt = this.moveSentAt.get(message.actionId);
            if (sentAt) { this.latencyMs = Date.now() - sentAt; this.moveSentAt.delete(message.actionId); }
          }
          this.handlers.forEach((handler) => handler(message));
        } catch { /* servidor autoritativo */ }
      });
    } catch { this.scheduleReconnect(); }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.retryTimer !== undefined) return;
    this.status = "reconnecting";
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.retryAttempt++, 5));
    this.retryTimer = window.setTimeout(() => { this.retryTimer = undefined; this.openSocket(); }, delay);
  }

  onMessage(handler: MessageHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  send(type: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }
  move(direction: "up" | "down" | "left" | "right", sprint = false): string | false {
    const actionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    if (!this.send("move", { actionId, direction, sprint })) return false;
    this.moveSentAt.set(actionId, Date.now());
    return actionId;
  }
  enterRegion(regionId: string): boolean { return this.send("world.region.enter", { regionId }); }
  requestSnapshot(): boolean { return this.send("snapshot.get"); }
  action(type: string, payload: Record<string, unknown> = {}): boolean { return this.send(type, payload); }
  close(): void {
    this.closedByUser = true;
    if (this.retryTimer !== undefined) { window.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    this.initialConnectionResolve = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.status = "offline-demo";
  }
}
