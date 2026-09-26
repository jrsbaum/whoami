import type { Account, FarmItem, FarmStructure, MarketListing, PlayerState, Session, WalletEntry } from "./domain.js";
import type { AccountRepository, FarmRepository, MarketListingResult, MarketPurchaseResult, MarketRepository, PlayerRepository, RepositoryBundle, SessionRepository, StructureRepository, WalletRepository } from "./repositories.js";

class InMemoryAccounts implements AccountRepository {
  private readonly byId = new Map<string, Account>();
  private readonly byNick = new Map<string, Account>();

  async findById(id: string): Promise<Account | undefined> {
    return this.byId.get(id);
  }

  async findByNormalizedNick(normalizedNick: string): Promise<Account | undefined> {
    return this.byNick.get(normalizedNick);
  }

  async insert(account: Account): Promise<void> {
    this.byId.set(account.id, account);
    this.byNick.set(account.normalizedNick, account);
  }
}

class InMemorySessions implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  async findByToken(token: string): Promise<Session | undefined> {
    return this.sessions.get(token);
  }

  async insert(session: Session): Promise<void> {
    this.sessions.set(session.token, session);
  }

  async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

class InMemoryPlayers implements PlayerRepository {
  private readonly byId = new Map<string, PlayerState>();
  private readonly byAccountId = new Map<string, PlayerState>();

  async findById(id: string): Promise<PlayerState | undefined> {
    return this.byId.get(id);
  }

  async findByAccountId(accountId: string): Promise<PlayerState | undefined> {
    return this.byAccountId.get(accountId);
  }

  async insert(player: PlayerState): Promise<void> {
    this.byId.set(player.id, player);
    this.byAccountId.set(player.accountId, player);
  }

  async update(player: PlayerState): Promise<void> {
    this.byId.set(player.id, player);
    this.byAccountId.set(player.accountId, player);
  }

  async creditCoins(playerId: string, amount: number, lastActiveAt: number): Promise<PlayerState | undefined> {
    const player = this.byId.get(playerId);
    if (!player) return undefined;
    const updated = { ...player, coins: player.coins + amount, lastActiveAt };
    await this.update(updated);
    return updated;
  }

  async accrueOffline(playerId: string, now: number, capSeconds: number, coinsPerMinute: number): Promise<PlayerState | undefined> {
    const player = this.byId.get(playerId);
    if (!player) return undefined;
    const elapsedSeconds = Math.min(capSeconds, Math.max(0, Math.floor((now - player.lastActiveAt) / 1_000)));
    if (elapsedSeconds === 0) return player;
    return this.creditCoins(playerId, Math.floor(elapsedSeconds / 60) * coinsPerMinute, now);
  }

  async listAll(): Promise<PlayerState[]> { return [...this.byId.values()]; }
}

class InMemoryFarm implements FarmRepository {
  private readonly items = new Map<string, FarmItem>();
  async listByOwnerId(ownerId: string): Promise<FarmItem[]> { return [...this.items.values()].filter((item) => item.ownerId === ownerId); }
  async listAll(): Promise<FarmItem[]> { return [...this.items.values()]; }
  async insert(item: FarmItem): Promise<void> { this.items.set(item.id, item); }
  async update(item: FarmItem): Promise<void> { this.items.set(item.id, item); }
  async delete(id: string): Promise<void> { this.items.delete(id); }
}

class InMemoryStructures implements StructureRepository {
  private readonly structures = new Map<string, FarmStructure>();
  async listByOwnerId(ownerId: string): Promise<FarmStructure[]> { return [...this.structures.values()].filter((structure) => structure.ownerId === ownerId); }
  async listAll(): Promise<FarmStructure[]> { return [...this.structures.values()]; }
  async insert(structure: FarmStructure): Promise<void> { this.structures.set(structure.id, structure); }
  async update(structure: FarmStructure): Promise<void> { this.structures.set(structure.id, structure); }
}

class InMemoryMarket implements MarketRepository {
  private readonly listings = new Map<string, MarketListing>();
  private readonly purchases = new Map<string, MarketPurchaseResult>();
  private queue = Promise.resolve();
  constructor(private readonly players: PlayerRepository) {}
  async listActive(): Promise<MarketListing[]> { return [...this.listings.values()]; }
  async findById(id: string): Promise<MarketListing | undefined> { return this.listings.get(id); }
  async createListing(listing: MarketListing): Promise<MarketListingResult> {
    return this.exclusive(async () => {
      const player = await this.players.findById(listing.sellerId);
      if (!player) throw new Error("player_not_found");
      const available = player.inventory[listing.contentId] ?? 0;
      if (available < listing.quantity) throw new Error("invalid_quantity");
      const updated: PlayerState = {
        ...player,
        inventory: { ...player.inventory, [listing.contentId]: available - listing.quantity },
        lastActiveAt: listing.createdAt
      };
      const normalized = { ...listing, sellerName: player.name };
      await this.players.update(updated);
      this.listings.set(normalized.id, normalized);
      return { listing: normalized, player: updated };
    });
  }

  async purchaseListing(listingId: string, buyerId: string, idempotencyKey: string): Promise<MarketPurchaseResult> {
    return this.exclusive(async () => {
      const receiptKey = `${buyerId}:${idempotencyKey}`;
      const previous = this.purchases.get(receiptKey);
      if (previous) return { ...previous, replayed: true };
      const listing = this.listings.get(listingId);
      if (!listing) throw new Error("listing_not_found");
      if (listing.sellerId === buyerId) throw new Error("cannot_buy_own_listing");
      const buyer = await this.players.findById(buyerId);
      const seller = await this.players.findById(listing.sellerId);
      if (!buyer || !seller) throw new Error("player_not_found");
      const total = listing.quantity * listing.unitPrice;
      if (buyer.coins < total) throw new Error("insufficient_coins");
      const buyerInventory = { ...buyer.inventory, [listing.contentId]: (buyer.inventory[listing.contentId] ?? 0) + listing.quantity };
      const updatedBuyer = { ...buyer, coins: buyer.coins - total, inventory: buyerInventory, lastActiveAt: Date.now() };
      const updatedSeller = { ...seller, coins: seller.coins + total, lastActiveAt: Date.now() };
      await this.players.update(updatedBuyer);
      await this.players.update(updatedSeller);
      this.listings.delete(listing.id);
      const result = { listing, buyer: updatedBuyer, seller: updatedSeller, replayed: false };
      this.purchases.set(receiptKey, result);
      return result;
    });
  }

  async insert(listing: MarketListing): Promise<void> { this.listings.set(listing.id, listing); }
  async delete(id: string): Promise<void> { this.listings.delete(id); }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

class InMemoryWallet implements WalletRepository {
  private readonly entries = new Map<string, WalletEntry>();
  async listByPlayerId(playerId: string): Promise<WalletEntry[]> { return [...this.entries.values()].filter((entry) => entry.playerId === playerId); }
  async insert(entry: WalletEntry): Promise<void> { this.entries.set(entry.id, entry); }
}

/** Dev-only adapter. Replace this bundle with PostgreSQL implementations without changing use cases. */
export function createInMemoryRepositories(): RepositoryBundle {
  const players = new InMemoryPlayers();
  return {
    accounts: new InMemoryAccounts(),
    sessions: new InMemorySessions(),
    players,
    farm: new InMemoryFarm(),
    structures: new InMemoryStructures(),
    market: new InMemoryMarket(players),
    wallet: new InMemoryWallet()
  };
}
