export type ContentCategory = "plant" | "fruit" | "animal" | "dinosaur";
export type ContentKind = "crop" | "animal" | "dinosaur";
export type Specialization = "fruits" | "vegetables" | "dinosaurs";
export type Quality = "common" | "good" | "perfect";
export type CareState = "awaiting-care" | "attended";
export type BehaviorState = "idle" | "wander" | "hungry" | "seekCare" | "eating" | "happy" | "produce";

export type GrowthStage = { id: string; visualKey: string; durationSeconds: number };
export type ContentInput = { itemId: string; quantity: number };
export type ContentOutput = { itemId: string; quantity: number; quality: Quality };

export type ContentDefinition = {
  id: string;
  version: number;
  displayName: string;
  category: ContentCategory;
  kind: ContentKind;
  specialization: Specialization;
  capabilities: readonly string[];
  stages: readonly GrowthStage[];
  inputs: readonly ContentInput[];
  outputs: readonly ContentOutput[];
  cycleSeconds: number | null;
  purchaseCost: number;
  careProfile: { improvesQuality: boolean; needsCare: boolean };
  behaviorProfile: { initialState: BehaviorState; states: readonly BehaviorState[] };
  visualVariants: readonly string[];
};

export type Clothing = "forest" | "coral" | "river";
export type HairStyle = "short" | "long";
export type PlayerAppearance = { clothing: Clothing; hair: HairStyle };

export const STARTING_COINS = 1_000;
export const INVENTORY_CAPACITY = 50;
export const ONLINE_REWARD_MULTIPLIER = 10;
export const OFFLINE_COINS_PER_HOUR = 12;
export const ONLINE_COINS_PER_HOUR = OFFLINE_COINS_PER_HOUR * ONLINE_REWARD_MULTIPLIER;

export const ITEM_CATALOG = [
  { id: "tomato-seed", displayName: "Semente de tomate" },
  { id: "orange-seed", displayName: "Semente de laranja" },
  { id: "dinosaur-fossil", displayName: "Fóssil de dinossauro" },
  { id: "tomato", displayName: "Tomate" },
  { id: "orange", displayName: "Laranja" },
  { id: "milk", displayName: "Leite" },
  { id: "dinosaur-egg", displayName: "Ovo de dinossauro" },
  { id: "feed", displayName: "Ração" }
] as const;

export type OriginShopOffer = {
  id: string;
  displayName: string;
  itemId: string;
  specialization: Specialization;
  cost: number;
  kind: "seed" | "sapling" | "egg" | "fossil" | "feed";
};

export const ORIGIN_SHOP_OFFERS: readonly OriginShopOffer[] = [
  { id: "fruit-orange-sapling", displayName: "Muda de laranjeira", itemId: "orange-seed", specialization: "fruits", cost: 10, kind: "sapling" },
  { id: "vegetable-tomato-seed", displayName: "Semente de tomate", itemId: "tomato-seed", specialization: "vegetables", cost: 10, kind: "seed" },
  { id: "dinosaur-egg", displayName: "Ovo de dinossauro", itemId: "dinosaur-egg", specialization: "dinosaurs", cost: 300, kind: "egg" },
  { id: "dinosaur-fossil", displayName: "Fóssil de dinossauro", itemId: "dinosaur-fossil", specialization: "dinosaurs", cost: 180, kind: "fossil" },
  { id: "dinosaur-feed", displayName: "Ração", itemId: "feed", specialization: "dinosaurs", cost: 20, kind: "feed" }
] as const;

const cropCare = { improvesQuality: true, needsCare: false } as const;
const creatureCare = { improvesQuality: true, needsCare: true } as const;

/** The shared playable footprint. Positions are tile coordinates, not pixels. */
export const WORLD_WIDTH_TILES = 80;
export const WORLD_HEIGHT_TILES = 60;
export const WORLD_TILE_SIZE = 48;

/** Open meadow inside the farm. The old (8, 8) tile sits against the trees at (9, 7), (10, 7) and (11, 8). */
export const PLAYER_SPAWN = { x: 20, y: 12 } as const;

export type WorldObstacleKind = "tree" | "rock" | "barn" | "market" | "house" | "gate" | "bridge";
export type WorldObstacle = { kind: WorldObstacleKind; x: number; y: number; width: number; height: number };

export const WORLD_OBSTACLES: readonly WorldObstacle[] = [
  { kind: "tree", x: 9, y: 7, width: 1, height: 1 }, { kind: "tree", x: 10, y: 7, width: 1, height: 1 }, { kind: "tree", x: 11, y: 8, width: 1, height: 1 },
  { kind: "tree", x: 65, y: 8, width: 1, height: 1 }, { kind: "tree", x: 66, y: 9, width: 1, height: 1 }, { kind: "tree", x: 64, y: 10, width: 1, height: 1 },
  { kind: "tree", x: 11, y: 49, width: 1, height: 1 }, { kind: "tree", x: 12, y: 50, width: 1, height: 1 }, { kind: "tree", x: 67, y: 47, width: 1, height: 1 },
  { kind: "tree", x: 70, y: 30, width: 1, height: 1 }, { kind: "tree", x: 71, y: 31, width: 1, height: 1 },
  { kind: "rock", x: 34, y: 10, width: 2, height: 1 }, { kind: "rock", x: 36, y: 10, width: 1, height: 1 }, { kind: "rock", x: 57, y: 48, width: 2, height: 1 },
  { kind: "barn", x: 6, y: 14, width: 6, height: 4 }, { kind: "market", x: 62, y: 21, width: 6, height: 4 }, { kind: "house", x: 28, y: 44, width: 5, height: 3 },
  { kind: "gate", x: 3, y: 28, width: 2, height: 2 }, { kind: "bridge", x: 39, y: 29, width: 7, height: 2 }
] as const;

export type WorldConnectionKind = "gate" | "bridge" | "path";
export type WorldConnection = {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  kind: WorldConnectionKind;
  entry: { x: number; y: number };
  exit: { x: number; y: number };
};

export type WorldRegion = {
  id: string;
  name: string;
  biome: string;
  feature: string;
  summary: string;
  fertility: number;
  polygon: readonly [number, number][];
  neighbors: readonly string[];
  connectionIds: string[];
  initial: boolean;
};

const region = (id: string, name: string, biome: string, feature: string, summary: string, fertility: number, polygon: readonly [number, number][], neighbors: readonly string[], initial = false): WorldRegion => ({ id, name, biome, feature, summary, fertility, polygon, neighbors, connectionIds: [], initial });

export const WORLD_REGIONS: WorldRegion[] = [
  region("region-center", "Coração do vale", "meadow", "estrada central", "O ponto de encontro do vale, fértil e conectado por todos os lados.", 84, [[450, 350], [550, 315], [650, 380], [625, 515], [530, 570], [420, 520], [390, 425]], ["region-north", "region-south", "region-east", "region-west"], true),
  region("region-north", "Serra das nascentes", "river", "ponte + nascente", "Uma região alta onde a água desce para o coração do vale.", 76, [[425, 170], [550, 115], [675, 175], [650, 315], [550, 350], [445, 300]], ["region-center", "region-north-east", "region-north-west"], true),
  region("region-south", "Campos dourados", "meadow", "campo aberto", "Espaço amplo para quem gosta de planejar a fazenda por etapas.", 88, [[430, 590], [545, 555], [665, 620], [700, 770], [545, 835], [390, 735]], ["region-center", "region-south-east", "region-south-west"], true),
  region("region-east", "Bosque do sol", "forest", "bosque + madeira", "Árvores antigas, clareiras e uma passagem protegida para o vale.", 71, [[680, 330], [815, 275], [950, 355], [920, 500], [725, 540], [635, 450]], ["region-center", "region-north-east", "region-south-east"], true),
  region("region-west", "Pedras antigas", "rocky", "caverna + pedra", "Um terreno marcado por rochas, fósseis e histórias debaixo do chão.", 64, [[110, 330], [275, 275], [405, 375], [365, 510], [195, 545], [75, 430]], ["region-center", "region-north-west", "region-south-west"], true),
  region("region-north-east", "Jardins da névoa", "lake", "lago + sementes", "Uma margem úmida onde novas rotas podem nascer.", 69, [[700, 100], [850, 90], [980, 185], [900, 300], [730, 285], [650, 190]], ["region-north", "region-east", "region-far-north" ]),
  region("region-north-west", "Mata funda", "forest", "floresta + sombra", "Uma faixa de mata que guarda o caminho da fronteira antiga.", 67, [[80, 105], [230, 65], [370, 145], [390, 280], [245, 300], [105, 245]], ["region-north", "region-west", "region-far-west"]),
  region("region-south-east", "Lagoa das garças", "lake", "lago + margem", "Água calma, solo úmido e um caminho de madeira até a fronteira.", 73, [[745, 590], [900, 550], [1010, 665], [940, 820], [790, 790], [680, 680]], ["region-east", "region-south", "region-far-east"]),
  region("region-south-west", "Vale vermelho", "rocky", "barreiro + pedra", "Uma região quente com trilhas abertas e minerais à vista.", 62, [[100, 600], [250, 555], [390, 635], [370, 780], [210, 835], [70, 720]], ["region-west", "region-south", "region-far-south"]),
  region("region-far-north", "Montes azuis", "rocky", "montanha + vento", "O alto mapa do vale, ainda distante e protegido pela névoa.", 58, [[700, 5], [850, 0], [1010, 80], [980, 175], [850, 90]], ["region-north-east"]),
  region("region-far-west", "Raízes do oeste", "forest", "floresta + trilha", "Uma borda verde que só aparece quando a vizinhança crescer.", 65, [[0, 5], [130, 0], [230, 65], [80, 105]], ["region-north-west"]),
  region("region-far-east", "Costa clara", "meadow", "campo + vento", "Uma abertura de horizonte para a próxima fase do mundo.", 79, [[980, 520], [1100, 580], [1120, 750], [1010, 820], [900, 700]], ["region-south-east"]),
  region("region-far-south", "Terras baixas", "river", "rio + várzea", "Uma fronteira futura onde o rio se espalha antes de voltar ao mar.", 70, [[0, 780], [100, 720], [210, 835], [150, 940], [0, 950]], ["region-south-west"])
] as const;

export const WORLD_CONNECTIONS: readonly WorldConnection[] = [
  { id: "center-north", fromRegionId: "region-center", toRegionId: "region-north", kind: "bridge", entry: { x: 40, y: 4 }, exit: { x: 40, y: 56 } },
  { id: "center-south", fromRegionId: "region-center", toRegionId: "region-south", kind: "path", entry: { x: 40, y: 56 }, exit: { x: 40, y: 4 } },
  { id: "center-east", fromRegionId: "region-center", toRegionId: "region-east", kind: "gate", entry: { x: 76, y: 29 }, exit: { x: 4, y: 29 } },
  { id: "center-west", fromRegionId: "region-center", toRegionId: "region-west", kind: "gate", entry: { x: 4, y: 29 }, exit: { x: 76, y: 29 } },
  { id: "north-east", fromRegionId: "region-north", toRegionId: "region-north-east", kind: "path", entry: { x: 76, y: 29 }, exit: { x: 4, y: 29 } },
  { id: "north-west", fromRegionId: "region-north", toRegionId: "region-north-west", kind: "path", entry: { x: 4, y: 29 }, exit: { x: 76, y: 29 } },
  { id: "east-south", fromRegionId: "region-east", toRegionId: "region-south-east", kind: "bridge", entry: { x: 40, y: 56 }, exit: { x: 40, y: 4 } },
  { id: "west-south", fromRegionId: "region-west", toRegionId: "region-south-west", kind: "path", entry: { x: 40, y: 56 }, exit: { x: 40, y: 4 } }
] as const;

for (const connection of WORLD_CONNECTIONS) {
  for (const regionId of [connection.fromRegionId, connection.toRegionId]) {
    const target = WORLD_REGIONS.find((candidate) => candidate.id === regionId);
    if (target && !target.connectionIds.includes(connection.id)) (target.connectionIds as string[]).push(connection.id);
  }
}

export const INITIAL_REGION_IDS = ["region-center", "region-north", "region-south", "region-east", "region-west"] as const;

export function getWorldRegion(id: string): WorldRegion | undefined { return WORLD_REGIONS.find((candidate) => candidate.id === id); }
export function getWorldConnection(id: string): WorldConnection | undefined { return WORLD_CONNECTIONS.find((candidate) => candidate.id === id); }

export function riverColumnAt(y: number): number {
  return 41 + Math.round(Math.sin(y * 0.32) * 2.2);
}

export function isWorldWaterTile(x: number, y: number): boolean {
  if (y >= 29 && y <= 30) return false;
  const riverColumn = riverColumnAt(y);
  return x >= riverColumn && x <= riverColumn + 2;
}

export const FARM_BOUNDARY: readonly [number, number][] = [[4, 5], [22, 2], [43, 4], [63, 10], [75, 23], [72, 39], [60, 54], [42, 58], [20, 56], [6, 46], [2, 28]];

export function isInsideFarmBoundary(x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = FARM_BOUNDARY.length - 1; index < FARM_BOUNDARY.length; previous = index++) {
    const [xi, yi] = FARM_BOUNDARY[index]; const [xj, yj] = FARM_BOUNDARY[previous];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isWorldTileWalkable(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= WORLD_WIDTH_TILES || y < 0 || y >= WORLD_HEIGHT_TILES) return false;
  if (!isInsideFarmBoundary(x, y) || isWorldWaterTile(x, y)) return false;
  return !WORLD_OBSTACLES.some((obstacle) => !["gate", "bridge"].includes(obstacle.kind) && x >= obstacle.x && x < obstacle.x + obstacle.width && y >= obstacle.y && y < obstacle.y + obstacle.height);
}

export const CONTENT_CATALOG: readonly ContentDefinition[] = [
  {
    id: "tomato", version: 1, displayName: "Tomate", category: "plant", kind: "crop", specialization: "vegetables",
    capabilities: ["grow", "care", "harvest"],
    inputs: [{ itemId: "tomato-seed", quantity: 1 }], outputs: [{ itemId: "tomato", quantity: 1, quality: "common" }],
    cycleSeconds: null, purchaseCost: 10, careProfile: cropCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "happy"] }, visualVariants: ["default"],
    stages: [
      { id: "soil", visualKey: "tomato-soil", durationSeconds: 0 },
      { id: "sprout", visualKey: "tomato-sprout", durationSeconds: 600 },
      { id: "ready", visualKey: "tomato-ready", durationSeconds: 600 }
    ]
  },
  {
    id: "orange-tree", version: 1, displayName: "Laranjeira", category: "fruit", kind: "crop", specialization: "fruits",
    capabilities: ["grow", "care", "produce", "harvest"],
    inputs: [{ itemId: "orange-seed", quantity: 1 }], outputs: [{ itemId: "orange", quantity: 1, quality: "common" }],
    cycleSeconds: 1_200, purchaseCost: 10, careProfile: cropCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "happy"] }, visualVariants: ["default"],
    stages: [
      { id: "sapling", visualKey: "orange-sapling", durationSeconds: 0 },
      { id: "tree", visualKey: "orange-tree", durationSeconds: 1_800 },
      { id: "producing", visualKey: "orange-tree-producing", durationSeconds: 0 }
    ]
  },
  {
    id: "cow", version: 1, displayName: "Vaca", category: "animal", kind: "animal", specialization: "dinosaurs",
    capabilities: ["feed", "care", "wander", "produce", "move"],
    inputs: [{ itemId: "feed", quantity: 1 }], outputs: [{ itemId: "milk", quantity: 1, quality: "common" }],
    cycleSeconds: 3_600, purchaseCost: 100, careProfile: creatureCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "wander", "hungry", "seekCare", "eating", "happy", "produce"] },
    visualVariants: ["default", "brown", "spotted"],
    stages: [
      { id: "baby", visualKey: "cow-baby", durationSeconds: 0 },
      { id: "adult", visualKey: "cow-adult", durationSeconds: 3_600 }
    ]
  },
  {
    id: "dinosaur", version: 1, displayName: "Dinossauro", category: "dinosaur", kind: "dinosaur", specialization: "dinosaurs",
    capabilities: ["incubate", "feed", "care", "wander", "produce", "move"],
    inputs: [{ itemId: "dinosaur-fossil", quantity: 1 }], outputs: [{ itemId: "dinosaur-egg", quantity: 1, quality: "common" }],
    cycleSeconds: 3_600, purchaseCost: 300, careProfile: creatureCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "wander", "hungry", "seekCare", "eating", "happy", "produce"] },
    visualVariants: ["default", "fern", "amber"],
    stages: [
      { id: "fossil", visualKey: "dinosaur-fossil", durationSeconds: 0 },
      { id: "egg", visualKey: "dinosaur-egg", durationSeconds: 2_700 },
      { id: "hatchling", visualKey: "dinosaur-hatchling", durationSeconds: 5_400 },
      { id: "adult", visualKey: "dinosaur-adult", durationSeconds: 10_800 }
    ]
  }
] as const;

export function getContentDefinition(id: string): ContentDefinition | undefined {
  return CONTENT_CATALOG.find((definition) => definition.id === id);
}

export function isKnownItemId(id: string): boolean {
  return ITEM_CATALOG.some((item) => item.id === id);
}

export function validateContentCatalog(catalog: readonly ContentDefinition[] = CONTENT_CATALOG): void {
  const ids = new Set<string>();
  for (const definition of catalog) {
    if (!definition.id || ids.has(definition.id)) throw new Error(`duplicate_content_id:${definition.id}`);
    ids.add(definition.id);
    if (!Number.isInteger(definition.version) || definition.version < 1 || !Number.isInteger(definition.purchaseCost) || definition.purchaseCost < 0) throw new Error(`invalid_definition:${definition.id}`);
    if (!definition.stages.length || definition.stages[0].durationSeconds !== 0) throw new Error(`invalid_initial_stage:${definition.id}`);
    const stageIds = new Set<string>();
    for (const stage of definition.stages) {
      if (!stage.id || stageIds.has(stage.id) || !Number.isFinite(stage.durationSeconds) || stage.durationSeconds < 0) throw new Error(`invalid_stage:${definition.id}:${stage.id}`);
      stageIds.add(stage.id);
    }
    for (const input of definition.inputs) {
      if (!isKnownItemId(input.itemId) || !Number.isInteger(input.quantity) || input.quantity < 1) throw new Error(`invalid_input:${definition.id}`);
    }
    for (const output of definition.outputs) {
      if (!isKnownItemId(output.itemId) || !Number.isInteger(output.quantity) || output.quantity < 1) throw new Error(`invalid_output:${definition.id}`);
    }
    if (definition.capabilities.includes("produce") && !definition.outputs.length) throw new Error(`missing_output:${definition.id}`);
    if (definition.cycleSeconds !== null && (!Number.isFinite(definition.cycleSeconds) || definition.cycleSeconds <= 0)) throw new Error(`invalid_cycle:${definition.id}`);
    if (!definition.visualVariants.length) throw new Error(`missing_visual_variant:${definition.id}`);
  }
}

validateContentCatalog();

export function isClothing(value: unknown): value is Clothing {
  return value === "forest" || value === "coral" || value === "river";
}

export function isHairStyle(value: unknown): value is HairStyle {
  return value === "short" || value === "long";
}

export function createDefaultAppearance(): PlayerAppearance {
  return { clothing: "forest", hair: "short" };
}

export const OUTFITS = [
  { id: "forest" as const, label: "Verde mata", swatch: "#315d4a" },
  { id: "coral" as const, label: "Coral", swatch: "#d86b5d" },
  { id: "river" as const, label: "Azul rio", swatch: "#3f7890" }
] as const;

export const HAIRS = [
  { id: "short" as const, label: "Curto" },
  { id: "long" as const, label: "Grande" }
] as const;

export const PALETTE = {
  forest: "#183b32",
  ink: "#16362e",
  moss: "#88af6d",
  grass: "#b9d18e",
  cream: "#f8f6ed",
  paper: "#fffdf7",
  river: "#4394a5",
  riverLight: "#9bd8ce",
  amber: "#f2b84b",
  coral: "#d86b5d",
  soil: "#76523e"
} as const;

export const MARKET_TILE = WORLD_OBSTACLES.find((obstacle) => obstacle.kind === "market") ?? { kind: "market" as const, x: 62, y: 21, width: 6, height: 4 };

export function itemDisplayName(itemId: string): string {
  return ITEM_CATALOG.find((item) => item.id === itemId)?.displayName ?? itemId;
}
