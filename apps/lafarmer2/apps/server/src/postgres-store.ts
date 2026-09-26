import { Pool, type QueryResultRow } from "pg";
import type { Account, FarmItem, FarmStructure, LandPlot, MarketListing, PlayerState, Session, Specialization, WalletEntry } from "./domain.js";
import type { AccountRepository, FarmRepository, MarketRepository, PlayerRepository, RepositoryBundle, SessionRepository, StructureRepository, WalletRepository } from "./repositories.js";

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  normalized_nick TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  farm_name TEXT NOT NULL DEFAULT '',
  specialization TEXT,
  plot JSONB,
  home_region_id TEXT,
  current_region_id TEXT,
  clothing TEXT NOT NULL CHECK (clothing IN ('forest', 'coral', 'river')),
  hair TEXT NOT NULL CHECK (hair IN ('short', 'long')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  inventory JSONB NOT NULL DEFAULT '{}'::jsonb,
  inventory_qualities JSONB NOT NULL DEFAULT '{}'::jsonb,
  inventory_capacity INTEGER NOT NULL DEFAULT 50 CHECK (inventory_capacity > 0),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  position_x DOUBLE PRECISION NOT NULL DEFAULT 5,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 5
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS inventory JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS inventory_qualities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS inventory_capacity INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE players ADD COLUMN IF NOT EXISTS farm_name TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS specialization TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS plot JSONB;
ALTER TABLE players ADD COLUMN IF NOT EXISTS home_region_id TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS current_region_id TEXT;

CREATE TABLE IF NOT EXISTS farm_items (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL DEFAULT 'region-center',
  structure_id UUID,
  content_id TEXT NOT NULL,
  planted_at TIMESTAMPTZ NOT NULL,
  last_care_at TIMESTAMPTZ,
  last_processed_at TIMESTAMPTZ NOT NULL,
  pending_quantity INTEGER NOT NULL DEFAULT 0 CHECK (pending_quantity >= 0),
  next_production_at TIMESTAMPTZ,
  quality TEXT NOT NULL DEFAULT 'common' CHECK (quality IN ('common', 'good', 'perfect')),
  care_state TEXT NOT NULL DEFAULT 'awaiting-care',
  behavior_state TEXT NOT NULL DEFAULT 'idle',
  appearance_variant_id TEXT NOT NULL DEFAULT 'default',
  position_x DOUBLE PRECISION NOT NULL,
  position_y DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seller_name TEXT NOT NULL,
  content_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  quality TEXT NOT NULL DEFAULT 'common' CHECK (quality IN ('common', 'good', 'perfect')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_structures (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL,
  structure_type TEXT NOT NULL,
  footprint JSONB NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'built',
  position_x DOUBLE PRECISION NOT NULL,
  position_y DOUBLE PRECISION NOT NULL
);

ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS last_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS region_id TEXT NOT NULL DEFAULT 'region-center';
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS structure_id UUID;
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS pending_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS next_production_at TIMESTAMPTZ;
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'common';
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS care_state TEXT NOT NULL DEFAULT 'awaiting-care';
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS behavior_state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE farm_items ADD COLUMN IF NOT EXISTS appearance_variant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'common';

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS market_purchase_receipts (
  buyer_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  listing_id UUID NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (buyer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`;

export async function initializePostgresSchema(pool: Pool): Promise<void> {
  await pool.query(POSTGRES_SCHEMA);
}

class PostgresAccounts implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Account | undefined> {
    const result = await this.pool.query<AccountRow>(
      "SELECT id, normalized_nick, nick, password_hash, created_at FROM accounts WHERE id = $1",
      [id]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : undefined;
  }

  async findByNormalizedNick(normalizedNick: string): Promise<Account | undefined> {
    const result = await this.pool.query<AccountRow>(
      "SELECT id, normalized_nick, nick, password_hash, created_at FROM accounts WHERE normalized_nick = $1",
      [normalizedNick]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : undefined;
  }

  async insert(account: Account): Promise<void> {
    await this.pool.query(
      `INSERT INTO accounts (id, normalized_nick, nick, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [account.id, account.normalizedNick, account.nick, account.passwordHash, account.createdAt]
    );
  }
}

class PostgresSessions implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async findByToken(token: string): Promise<Session | undefined> {
    const result = await this.pool.query<SessionRow>(
      "SELECT token, account_id, expires_at FROM sessions WHERE token = $1",
      [token]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async insert(session: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token, account_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [session.token, session.accountId, session.expiresAt]
    );
  }

  async delete(token: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  }
}

class PostgresPlayers implements PlayerRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<PlayerState | undefined> {
    const result = await this.pool.query<PlayerRow>(playerSelect + " WHERE id = $1", [id]);
    return result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
  }

  async findByAccountId(accountId: string): Promise<PlayerState | undefined> {
    const result = await this.pool.query<PlayerRow>(playerSelect + " WHERE account_id = $1", [accountId]);
    return result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
  }

  async insert(player: PlayerState): Promise<void> {
    await this.pool.query(
      `INSERT INTO players (id, account_id, name, farm_name, specialization, plot, home_region_id, current_region_id, clothing, hair, coins, inventory, inventory_qualities, inventory_capacity, last_active_at, position_x, position_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, to_timestamp($15 / 1000.0), $16, $17)`,
      [
        player.id,
        player.accountId,
        player.name,
        player.farmName,
        player.specialization,
        player.plot ? JSON.stringify(player.plot) : null,
        player.homeRegionId,
        player.currentRegionId,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        JSON.stringify(player.inventory),
        JSON.stringify(player.inventoryQualities),
        player.inventoryCapacity,
        player.lastActiveAt,
        player.position.x,
        player.position.y
      ]
    );
  }

  async update(player: PlayerState): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET name = $2, farm_name = $3, specialization = $4, plot = $5, home_region_id = $6, current_region_id = $7, clothing = $8, hair = $9, coins = $10, inventory = $11, inventory_qualities = $12, inventory_capacity = $13, last_active_at = to_timestamp($14 / 1000.0), position_x = $15, position_y = $16
       WHERE id = $1`,
      [
        player.id,
        player.name,
        player.farmName,
        player.specialization,
        player.plot ? JSON.stringify(player.plot) : null,
        player.homeRegionId,
        player.currentRegionId,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        JSON.stringify(player.inventory),
        JSON.stringify(player.inventoryQualities),
        player.inventoryCapacity,
        player.lastActiveAt,
        player.position.x,
        player.position.y
      ]
    );
  }

  async creditCoins(playerId: string, amount: number, lastActiveAt: number): Promise<PlayerState | undefined> {
    const result = await this.pool.query<PlayerRow>(`UPDATE players SET coins = coins + $2, last_active_at = to_timestamp($3 / 1000.0) WHERE id = $1 RETURNING ${playerColumns}`, [playerId, amount, lastActiveAt]);
    return result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
  }

  async accrueOffline(playerId: string, now: number, capSeconds: number, coinsPerMinute: number): Promise<PlayerState | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PlayerRow>(playerSelect + " WHERE id = $1 FOR UPDATE", [playerId]);
      const player = result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
      if (!player) { await client.query("COMMIT"); return undefined; }
      const elapsedSeconds = Math.min(capSeconds, Math.max(0, Math.floor((now - player.lastActiveAt) / 1_000)));
      if (elapsedSeconds === 0) { await client.query("COMMIT"); return player; }
      const coins = Math.floor(elapsedSeconds / 60) * coinsPerMinute;
      const updated = await client.query<PlayerRow>(`UPDATE players SET coins = coins + $2, last_active_at = to_timestamp($3 / 1000.0) WHERE id = $1 RETURNING ${playerColumns}`, [playerId, coins, now]);
      await client.query("COMMIT");
      return updated.rows[0] ? mapPlayer(updated.rows[0]) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listAll(): Promise<PlayerState[]> {
    const result = await this.pool.query<PlayerRow>(playerSelect);
    return result.rows.map(mapPlayer);
  }
}

class PostgresFarm implements FarmRepository {
  constructor(private readonly pool: Pool) {}
  async listByOwnerId(ownerId: string): Promise<FarmItem[]> { const result = await this.pool.query<FarmRow>(farmSelect + " WHERE owner_id = $1", [ownerId]); return result.rows.map(mapFarm); }
  async listAll(): Promise<FarmItem[]> { const result = await this.pool.query<FarmRow>(farmSelect); return result.rows.map(mapFarm); }
  async insert(item: FarmItem): Promise<void> { await this.pool.query("INSERT INTO farm_items (id, owner_id, region_id, structure_id, content_id, planted_at, last_care_at, last_processed_at, pending_quantity, next_production_at, quality, care_state, behavior_state, appearance_variant_id, position_x, position_y) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END, to_timestamp($8 / 1000.0), $9, CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10 / 1000.0) END, $11, $12, $13, $14, $15, $16)", [item.id, item.ownerId, item.regionId, item.structureId, item.contentId, item.plantedAt, item.lastCareAt, item.lastProcessedAt, item.pendingQuantity, item.nextProductionAt, item.quality, item.careState, item.behaviorState, item.appearanceVariantId, item.position.x, item.position.y]); }
  async update(item: FarmItem): Promise<void> { await this.pool.query("UPDATE farm_items SET region_id = $2, structure_id = $3, last_care_at = CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4 / 1000.0) END, last_processed_at = to_timestamp($5 / 1000.0), pending_quantity = $6, next_production_at = CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END, quality = $8, care_state = $9, behavior_state = $10, appearance_variant_id = $11, position_x = $12, position_y = $13 WHERE id = $1", [item.id, item.regionId, item.structureId, item.lastCareAt, item.lastProcessedAt, item.pendingQuantity, item.nextProductionAt, item.quality, item.careState, item.behaviorState, item.appearanceVariantId, item.position.x, item.position.y]); }
  async delete(id: string): Promise<void> { await this.pool.query("DELETE FROM farm_items WHERE id = $1", [id]); }
}

class PostgresStructures implements StructureRepository {
  constructor(private readonly pool: Pool) {}
  async listByOwnerId(ownerId: string): Promise<FarmStructure[]> { const result = await this.pool.query<StructureRow>(structureSelect + " WHERE owner_id = $1", [ownerId]); return result.rows.map(mapStructure); }
  async listAll(): Promise<FarmStructure[]> { const result = await this.pool.query<StructureRow>(structureSelect); return result.rows.map(mapStructure); }
  async insert(structure: FarmStructure): Promise<void> { await this.pool.query("INSERT INTO farm_structures (id, owner_id, region_id, structure_type, footprint, capacity, cost, state, position_x, position_y) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [structure.id, structure.ownerId, structure.regionId, structure.type, JSON.stringify(structure.footprint), structure.capacity, structure.cost, structure.state, structure.position.x, structure.position.y]); }
  async update(structure: FarmStructure): Promise<void> { await this.pool.query("UPDATE farm_structures SET footprint = $2, capacity = $3, cost = $4, state = $5, position_x = $6, position_y = $7 WHERE id = $1", [structure.id, JSON.stringify(structure.footprint), structure.capacity, structure.cost, structure.state, structure.position.x, structure.position.y]); }
}

class PostgresMarket implements MarketRepository {
  constructor(private readonly pool: Pool) {}
  async listActive(): Promise<MarketListing[]> { const result = await this.pool.query<MarketRow>(marketSelect); return result.rows.map(mapMarket); }
  async findById(id: string): Promise<MarketListing | undefined> { const result = await this.pool.query<MarketRow>(marketSelect + " WHERE id = $1", [id]); return result.rows[0] ? mapMarket(result.rows[0]) : undefined; }
  async insert(listing: MarketListing): Promise<void> { await this.pool.query("INSERT INTO market_listings (id, seller_id, seller_name, content_id, quantity, unit_price, quality, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))", [listing.id, listing.sellerId, listing.sellerName, listing.contentId, listing.quantity, listing.unitPrice, listing.quality, listing.createdAt]); }
  async delete(id: string): Promise<void> { await this.pool.query("DELETE FROM market_listings WHERE id = $1", [id]); }
}

class PostgresWallet implements WalletRepository {
  constructor(private readonly pool: Pool) {}
  async listByPlayerId(playerId: string): Promise<WalletEntry[]> { const result = await this.pool.query<WalletRow>("SELECT id, player_id, delta, balance, reason, reference_id, created_at FROM wallet_ledger WHERE player_id = $1 ORDER BY created_at ASC", [playerId]); return result.rows.map(mapWallet); }
  async insert(entry: WalletEntry): Promise<void> { await this.pool.query("INSERT INTO wallet_ledger (id, player_id, delta, balance, reason, reference_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))", [entry.id, entry.playerId, entry.delta, entry.balance, entry.reason, entry.referenceId, entry.createdAt]); }
}

export function createPostgresRepositories(pool: Pool): RepositoryBundle {
  return {
    accounts: new PostgresAccounts(pool),
    sessions: new PostgresSessions(pool),
    players: new PostgresPlayers(pool),
    farm: new PostgresFarm(pool),
    structures: new PostgresStructures(pool),
    market: new PostgresMarket(pool),
    wallet: new PostgresWallet(pool)
  };
}

type AccountRow = QueryResultRow & {
  id: string;
  normalized_nick: string;
  nick: string;
  password_hash: string;
  created_at: Date | string;
};

type SessionRow = QueryResultRow & {
  token: string;
  account_id: string;
  expires_at: Date | string;
};

type PlayerRow = QueryResultRow & {
  id: string;
  account_id: string;
  name: string;
  farm_name: string;
  specialization: Specialization | null;
  plot: LandPlot | null;
  home_region_id: string | null;
  current_region_id: string | null;
  clothing: "forest" | "coral" | "river";
  hair: "short" | "long";
  coins: number;
  inventory: Record<string, number>;
  inventory_qualities: Record<string, Partial<Record<"common" | "good" | "perfect", number>>>;
  inventory_capacity: number;
  last_active_at: Date | string;
  position_x: number;
  position_y: number;
};

const playerSelect = `SELECT id, account_id, name, farm_name, specialization, plot, home_region_id, current_region_id, clothing, hair, coins, inventory, inventory_qualities, inventory_capacity, last_active_at, position_x, position_y FROM players`;
const playerColumns = `id, account_id, name, farm_name, specialization, plot, home_region_id, current_region_id, clothing, hair, coins, inventory, inventory_qualities, inventory_capacity, last_active_at, position_x, position_y`;
const farmSelect = `SELECT id, owner_id, region_id, structure_id, content_id, planted_at, last_care_at, last_processed_at, pending_quantity, next_production_at, quality, care_state, behavior_state, appearance_variant_id, position_x, position_y FROM farm_items`;
const structureSelect = `SELECT id, owner_id, region_id, structure_type, footprint, capacity, cost, state, position_x, position_y FROM farm_structures`;
const marketSelect = `SELECT id, seller_id, seller_name, content_id, quantity, unit_price, quality, created_at FROM market_listings`;

type FarmRow = QueryResultRow & { id: string; owner_id: string; region_id: string; structure_id: string | null; content_id: string; planted_at: Date | string; last_care_at: Date | string | null; last_processed_at: Date | string; pending_quantity: number; next_production_at: Date | string | null; quality: "common" | "good" | "perfect"; care_state: "awaiting-care" | "attended"; behavior_state: "idle" | "wander" | "hungry" | "seekCare" | "eating" | "happy" | "produce"; appearance_variant_id: string; position_x: number; position_y: number };
type StructureRow = QueryResultRow & { id: string; owner_id: string; region_id: string; structure_type: FarmStructure["type"]; footprint: FarmStructure["footprint"]; capacity: number; cost: number; state: FarmStructure["state"]; position_x: number; position_y: number };
type MarketRow = QueryResultRow & { id: string; seller_id: string; seller_name: string; content_id: string; quantity: number; unit_price: number; quality: "common" | "good" | "perfect"; created_at: Date | string };
type WalletRow = QueryResultRow & { id: string; player_id: string; delta: number; balance: number; reason: WalletEntry["reason"]; reference_id: string | null; created_at: Date | string };

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    normalizedNick: row.normalized_nick,
    nick: row.nick,
    passwordHash: row.password_hash,
    createdAt: asDate(row.created_at)
  };
}

function mapSession(row: SessionRow): Session {
  return {
    token: row.token,
    accountId: row.account_id,
    expiresAt: new Date(row.expires_at).getTime()
  };
}

function mapPlayer(row: PlayerRow): PlayerState {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    farmName: row.farm_name ?? "",
    specialization: row.specialization,
    plot: row.plot,
    homeRegionId: row.home_region_id,
    currentRegionId: row.current_region_id,
    appearance: { clothing: row.clothing, hair: row.hair },
    coins: row.coins,
    inventory: row.inventory ?? {},
    inventoryQualities: row.inventory_qualities ?? {},
    inventoryCapacity: row.inventory_capacity ?? 50,
    lastActiveAt: new Date(row.last_active_at).getTime(),
    position: { x: row.position_x, y: row.position_y }
  };
}

function mapFarm(row: FarmRow): FarmItem { return { id: row.id, ownerId: row.owner_id, regionId: row.region_id, structureId: row.structure_id, contentId: row.content_id, plantedAt: new Date(row.planted_at).getTime(), lastCareAt: row.last_care_at ? new Date(row.last_care_at).getTime() : null, lastProcessedAt: new Date(row.last_processed_at).getTime(), pendingQuantity: row.pending_quantity, nextProductionAt: row.next_production_at ? new Date(row.next_production_at).getTime() : null, quality: row.quality, careState: row.care_state, behaviorState: row.behavior_state, appearanceVariantId: row.appearance_variant_id, position: { x: row.position_x, y: row.position_y } }; }
function mapStructure(row: StructureRow): FarmStructure { return { id: row.id, ownerId: row.owner_id, regionId: row.region_id, type: row.structure_type, footprint: row.footprint, capacity: row.capacity, cost: row.cost, state: row.state, position: { x: row.position_x, y: row.position_y } }; }
function mapMarket(row: MarketRow): MarketListing { return { id: row.id, sellerId: row.seller_id, sellerName: row.seller_name, contentId: row.content_id, quantity: row.quantity, unitPrice: row.unit_price, quality: row.quality, createdAt: new Date(row.created_at).getTime() }; }
function mapWallet(row: WalletRow): WalletEntry { return { id: row.id, playerId: row.player_id, delta: row.delta, balance: row.balance, reason: row.reason, referenceId: row.reference_id, createdAt: new Date(row.created_at).getTime() }; }

function asDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
