import type { Account, FarmItem, FarmStructure, MarketListing, PlayerState, Session, WalletEntry } from "./domain.js";

export type MarketListingResult = {
  listing: MarketListing;
  player: PlayerState;
};

export type MarketPurchaseResult = {
  listing: MarketListing;
  buyer: PlayerState;
  seller: PlayerState;
  replayed: boolean;
};

export interface AccountRepository {
  findById(id: string): Promise<Account | undefined>;
  findByNormalizedNick(normalizedNick: string): Promise<Account | undefined>;
  insert(account: Account): Promise<void>;
}

export interface SessionRepository {
  findByToken(token: string): Promise<Session | undefined>;
  insert(session: Session): Promise<void>;
  delete(token: string): Promise<void>;
}

export interface PlayerRepository {
  findById(id: string): Promise<PlayerState | undefined>;
  findByAccountId(accountId: string): Promise<PlayerState | undefined>;
  insert(player: PlayerState): Promise<void>;
  update(player: PlayerState): Promise<void>;
  creditCoins(playerId: string, amount: number, lastActiveAt: number): Promise<PlayerState | undefined>;
  accrueOffline(playerId: string, now: number, capSeconds: number, coinsPerMinute: number): Promise<PlayerState | undefined>;
  listAll(): Promise<PlayerState[]>;
}

export interface FarmRepository {
  listByOwnerId(ownerId: string): Promise<FarmItem[]>;
  listAll(): Promise<FarmItem[]>;
  insert(item: FarmItem): Promise<void>;
  update(item: FarmItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface StructureRepository {
  listByOwnerId(ownerId: string): Promise<FarmStructure[]>;
  listAll(): Promise<FarmStructure[]>;
  insert(structure: FarmStructure): Promise<void>;
  update(structure: FarmStructure): Promise<void>;
}

export interface MarketRepository {
  listActive(): Promise<MarketListing[]>;
  findById(id: string): Promise<MarketListing | undefined>;
  insert(listing: MarketListing): Promise<void>;
  delete(id: string): Promise<void>;
  createListing?(listing: MarketListing): Promise<MarketListingResult>;
  purchaseListing?(listingId: string, buyerId: string, idempotencyKey: string): Promise<MarketPurchaseResult>;
}

export interface WalletRepository {
  listByPlayerId(playerId: string): Promise<WalletEntry[]>;
  insert(entry: WalletEntry): Promise<void>;
}

export type RepositoryBundle = {
  accounts: AccountRepository;
  sessions: SessionRepository;
  players: PlayerRepository;
  farm: FarmRepository;
  structures: StructureRepository;
  market: MarketRepository;
  wallet: WalletRepository;
};
