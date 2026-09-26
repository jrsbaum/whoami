import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { createDefaultAppearance, INVENTORY_CAPACITY, PLAYER_SPAWN, STARTING_COINS, type Clothing, type HairStyle } from "@lafarmer2/content";
import type { Account, PlayerState, Session, Specialization, WalletEntry } from "./domain.js";
import type { RepositoryBundle } from "./repositories.js";
import { buildLandOptions, buildWorldOverview } from "./world-service.js";

export const PASSWORD_MIN_LENGTH = 8;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class AuthError extends Error {
  constructor(public readonly code: "invalid_credentials" | "nick_taken" | "invalid_nick" | "invalid_password" | "credentials_not_saved" | "invalid_land" | "invalid_farm_name" | "invalid_specialization" | "region_reserved") {
    super(code);
  }
}

export type RegisterInput = {
  nick: string;
  password: string;
  credentialsSaved: boolean;
};

export type LoginInput = {
  nick: string;
  password: string;
};

export type ProfileInput = {
  name: string;
  clothing: Clothing;
  hair: HairStyle;
  farmName?: string;
  specialization?: Specialization;
  plotId?: string;
};

export type AuthResult = {
  token: string;
  player: PlayerState;
  credentials: { nick: string };
};

export function normalizeNick(nick: string): string {
  return nick.trim().toLocaleLowerCase("pt-BR");
}

export function isValidNick(nick: string): boolean {
  return /^(?=.{3,20}$)[\p{L}\p{N}_-]+$/u.test(nick);
}

export class AuthService {
  private readonly regionReservations = new Map<string, { playerId: string; expiresAt: number }>();

  constructor(
    private readonly repositories: RepositoryBundle,
    private readonly now: () => number = () => Date.now()
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const nick = input.nick.trim();
    if (!input.credentialsSaved) throw new AuthError("credentials_not_saved");
    if (!isValidNick(nick)) throw new AuthError("invalid_nick");
    if (input.password.length < PASSWORD_MIN_LENGTH) throw new AuthError("invalid_password");

    const normalizedNick = normalizeNick(nick);
    if (await this.repositories.accounts.findByNormalizedNick(normalizedNick)) {
      throw new AuthError("nick_taken");
    }

    const account: Account = {
      id: randomUUID(),
      nick,
      normalizedNick,
      passwordHash: await bcrypt.hash(input.password, 12),
      createdAt: new Date(this.now()).toISOString()
    };
    await this.repositories.accounts.insert(account);

    const player: PlayerState = {
      id: randomUUID(),
      accountId: account.id,
      name: nick,
      farmName: "",
      specialization: null,
      plot: null,
      appearance: createDefaultAppearance(),
      coins: STARTING_COINS,
      inventory: {},
      inventoryQualities: {},
      inventoryCapacity: INVENTORY_CAPACITY,
      lastActiveAt: this.now(),
      homeRegionId: null,
      currentRegionId: null,
      position: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y }
    };
    await this.repositories.players.insert(player);
    const startingEntry: WalletEntry = {
      id: randomUUID(), playerId: player.id, delta: STARTING_COINS, balance: STARTING_COINS,
      reason: "starting_balance", referenceId: account.id, createdAt: this.now()
    };
    await this.repositories.wallet.insert(startingEntry);
    return this.issueSession(account, player);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const account = await this.repositories.accounts.findByNormalizedNick(normalizeNick(input.nick));
    if (!account || !(await bcrypt.compare(input.password, account.passwordHash))) {
      throw new AuthError("invalid_credentials");
    }
    const player = await this.repositories.players.findByAccountId(account.id);
    if (!player) throw new AuthError("invalid_credentials");
    return this.issueSession(account, player);
  }

  async authenticate(token: string): Promise<PlayerState | undefined> {
    if (!token) return undefined;
    const session = await this.repositories.sessions.findByToken(token);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) {
      await this.repositories.sessions.delete(token);
      return undefined;
    }
    return this.repositories.players.findByAccountId(session.accountId);
  }

  async updateProfile(playerId: string, input: ProfileInput): Promise<PlayerState> {
    const player = await this.repositories.players.findById(playerId);
    if (!player) throw new AuthError("invalid_credentials");
    const name = input.name.trim();
    if (name.length < 1 || name.length > 24) throw new AuthError("invalid_nick");
    const farmName = input.farmName === undefined ? player.farmName : input.farmName.trim();
    if (farmName.length > 32) throw new AuthError("invalid_farm_name");
    const specialization = input.specialization === undefined ? player.specialization : input.specialization;
    if (specialization && !["fruits", "vegetables", "dinosaurs"].includes(specialization)) throw new AuthError("invalid_specialization");
    if (player.specialization && input.specialization && input.specialization !== player.specialization) throw new AuthError("invalid_specialization");
    let plot = player.plot;
    if (input.plotId !== undefined && !player.plot) {
      const reservation = this.regionReservations.get(input.plotId);
      if (reservation && reservation.playerId !== playerId && reservation.expiresAt > this.now()) throw new AuthError("region_reserved");
      const selected = (await this.landOptions(playerId)).find((option) => option.id === input.plotId);
      if (!selected) throw new AuthError("invalid_land");
      plot = selected;
    }
    if (player.plot && input.plotId !== undefined && input.plotId !== player.plot.id) throw new AuthError("invalid_land");
    const updated: PlayerState = {
      ...player,
      name,
      farmName,
      specialization,
      plot,
      homeRegionId: plot?.regionId ?? player.homeRegionId,
      currentRegionId: plot?.regionId ?? player.currentRegionId,
      appearance: { clothing: input.clothing, hair: input.hair }
    };
    await this.repositories.players.update(updated);
    return updated;
  }

  async reserveRegion(playerId: string, regionId: string): Promise<{ regionId: string; expiresAt: number }> {
    const now = this.now();
    for (const [id, reservation] of this.regionReservations) if (reservation.expiresAt <= now) this.regionReservations.delete(id);
    const existing = this.regionReservations.get(regionId);
    if (existing && existing.playerId !== playerId) throw new AuthError("region_reserved");
    const available = (await this.landOptions(playerId)).some((option) => option.regionId === regionId);
    if (!available) throw new AuthError("invalid_land");
    const expiresAt = now + 15 * 60 * 1_000;
    this.regionReservations.set(regionId, { playerId, expiresAt });
    return { regionId, expiresAt };
  }

  async landOptions(playerId: string) {
    const now = this.now();
    for (const [id, reservation] of this.regionReservations) if (reservation.expiresAt <= now) this.regionReservations.delete(id);
    const players = await this.repositories.players.listAll();
    return buildLandOptions(players, playerId).filter((option) => {
      const reservation = this.regionReservations.get(option.regionId);
      return !reservation || reservation.playerId === playerId;
    });
  }

  async worldOverview(playerId: string) {
    const now = this.now();
    for (const [id, reservation] of this.regionReservations) if (reservation.expiresAt <= now) this.regionReservations.delete(id);
    const players = await this.repositories.players.listAll();
    const reserved = new Set([...this.regionReservations.entries()].filter(([, reservation]) => reservation.expiresAt > now && reservation.playerId !== playerId).map(([regionId]) => regionId));
    return buildWorldOverview(players, playerId).map((region) => reserved.has(region.id) && region.status === "frontier" ? { ...region, status: "locked" as const, connectionId: null } : region);
  }

  private async issueSession(account: Account, player: PlayerState): Promise<AuthResult> {
    const session: Session = {
      token: randomBytes(32).toString("base64url"),
      accountId: account.id,
      expiresAt: this.now() + SESSION_TTL_MS
    };
    await this.repositories.sessions.insert(session);
    return { token: session.token, player, credentials: { nick: account.nick } };
  }
}
