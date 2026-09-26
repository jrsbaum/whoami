import type { BehaviorState, CareState, PlayerAppearance, Quality } from "@lafarmer2/content";

export type Account = {
  id: string;
  normalizedNick: string;
  nick: string;
  passwordHash: string;
  createdAt: string;
};

export type Session = {
  token: string;
  accountId: string;
  expiresAt: number;
};

export type Specialization = "fruits" | "vegetables" | "dinosaurs";

export type Polygon = readonly [number, number][];

export type LandOption = {
  id: string;
  regionId: string;
  x: number;
  y: number;
  biome: string;
  title: string;
  feature: string;
  summary: string;
  fertility: number;
  nearbyNeighbors: number;
  polygon: Polygon;
  connectionId: string | null;
  locked: boolean;
};

export type LandPlot = LandOption;

export type PlayerState = {
  id: string;
  accountId: string;
  name: string;
  farmName: string;
  specialization: Specialization | null;
  plot: LandPlot | null;
  homeRegionId: string | null;
  currentRegionId: string | null;
  appearance: PlayerAppearance;
  coins: number;
  inventory: Record<string, number>;
  inventoryQualities: Record<string, Partial<Record<Quality, number>>>;
  inventoryCapacity: number;
  lastActiveAt: number;
  position: {
    x: number;
    y: number;
  };
};

export type FarmStructureType = "house" | "field" | "orchard" | "animal_pen" | "dinosaur_enclosure";
export type FarmStructure = {
  id: string;
  ownerId: string;
  regionId: string;
  type: FarmStructureType;
  footprint: Polygon;
  capacity: number;
  cost: number;
  state: "planned" | "built";
  position: { x: number; y: number };
};

export type FarmItem = {
  id: string;
  ownerId: string;
  regionId: string;
  structureId: string | null;
  contentId: string;
  plantedAt: number;
  lastCareAt: number | null;
  lastProcessedAt: number;
  pendingQuantity: number;
  nextProductionAt: number | null;
  quality: Quality;
  careState: CareState;
  behaviorState: BehaviorState;
  appearanceVariantId: string;
  position: { x: number; y: number };
};

export type FarmItemView = FarmItem & {
  stageId: string;
  visualKey: string;
  ready: boolean;
  quality: Quality;
  careState: CareState;
  behaviorState: BehaviorState;
  appearanceVariantId: string;
  pendingQuantity: number;
};

export type MarketListing = {
  id: string;
  sellerId: string;
  sellerName: string;
  contentId: string;
  quantity: number;
  unitPrice: number;
  quality: Quality;
  createdAt: number;
};

export type WalletEntry = {
  id: string;
  playerId: string;
  delta: number;
  balance: number;
  reason: "starting_balance" | "offline_reward" | "online_reward" | "plant" | "adopt" | "market_purchase" | "market_sale";
  referenceId: string | null;
  createdAt: number;
};

export type Direction = "up" | "down" | "left" | "right";

export type MoveCommand = {
  actionId: string;
  direction: Direction;
  sprint?: boolean;
};

export type WorldPresence = {
  id: string;
  name: string;
  farmName: string;
  homeRegionId: string | null;
  currentRegionId: string | null;
  appearance: PlayerAppearance;
  position: { x: number; y: number };
  online: boolean;
};

export type MoveResult = {
  actionId: string;
  player: PlayerState;
  accepted: true;
};

export type WorldSnapshot = {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  player: PlayerState;
  players: PlayerState[];
  farmItems: FarmItemView[];
  structures: FarmStructure[];
  listings: MarketListing[];
  presence: WorldPresence[];
  offlineProgress: { coins: number; completedCycles: number; blockedByCapacity: number };
};
