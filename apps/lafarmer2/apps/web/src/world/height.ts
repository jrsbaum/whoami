import {
  FARM_BOUNDARY,
  WORLD_HEIGHT_TILES,
  WORLD_OBSTACLES,
  WORLD_WIDTH_TILES,
  isInsideFarmBoundary,
  riverColumnAt
} from "@lafarmer2/content";

export const TILE = 3;
export const WATER_LEVEL = 0;
export const HALF_WIDTH = (WORLD_WIDTH_TILES * TILE) / 2;
export const HALF_DEPTH = (WORLD_HEIGHT_TILES * TILE) / 2;

export const tileToWorldX = (x: number): number => (x - WORLD_WIDTH_TILES / 2) * TILE;
export const tileToWorldZ = (y: number): number => (y - WORLD_HEIGHT_TILES / 2) * TILE;

export const worldToTile = (x: number, z: number): { x: number; y: number } => ({
  x: x / TILE + WORLD_WIDTH_TILES / 2,
  y: z / TILE + WORLD_HEIGHT_TILES / 2
});

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const hash2 = (x: number, y: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export const valueNoise = (x: number, y: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** Fractal value noise in [0, 1]. */
export const fbm = (x: number, y: number, octaves = 4): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(px, py) * amp;
    norm += amp;
    const nx = px * 1.6 + py * 1.2 + 3.1;
    py = -px * 1.2 + py * 1.6 + 1.7;
    px = nx;
    amp *= 0.5;
  }
  return sum / norm;
};

/** Sharp-crested ridges in [0, 1] for the mountains. */
export const ridged = (x: number, y: number, octaves = 5): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = 1 - Math.abs(valueNoise(px, py) * 2 - 1);
    const sharp = n * n * weight;
    weight = Math.min(1, sharp * 1.6);
    sum += sharp * amp;
    norm += amp;
    const nx = px * 1.9 + py * 0.9 + 5.3;
    py = -px * 0.9 + py * 1.9 + 2.9;
    px = nx;
    amp *= 0.5;
  }
  return sum / norm;
};

/** Deterministic PRNG for placement. */
export const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

/** Signed distance to the farm boundary in tiles: negative inside the playable farm. */
export const farmSignedDistance = (tx: number, ty: number): number => {
  let distance = Infinity;
  for (let index = 0, previous = FARM_BOUNDARY.length - 1; index < FARM_BOUNDARY.length; previous = index++) {
    const [ax, ay] = FARM_BOUNDARY[previous];
    const [bx, by] = FARM_BOUNDARY[index];
    distance = Math.min(distance, distanceToSegment(tx, ty, ax, ay, bx, by));
  }
  return isInsideFarmBoundary(tx, ty) ? -distance : distance;
};

const bigMeander = (ty: number): number => {
  const beyond = ty < 0 ? -ty : ty > WORLD_HEIGHT_TILES - 1 ? ty - (WORLD_HEIGHT_TILES - 1) : 0;
  if (beyond <= 0) return 0;
  return (Math.sin(ty * 0.045 + 0.8) * 9 + Math.sin(ty * 0.021 - 1.3) * 14) * smoothstep(0, 60, beyond);
};

/** Smooth river centre line in tile columns. Inside the farm it matches the water tiles of the server. */
export const riverCenterTile = (ty: number): number => 42 + Math.sin(ty * 0.32) * 2.2 + bigMeander(ty);

export const riverCenterWorld = (wz: number): number => tileToWorldX(riverCenterTile(worldToTile(0, wz).y));

/** Extra river width on each side beyond the farm, in tiles: the gorge stays narrow, the lowlands open up. */
const widening = (ty: number): number => {
  if (ty < 0) return Math.min(1, -ty / 16);
  if (ty > WORLD_HEIGHT_TILES - 1) return Math.min(3, (ty - (WORLD_HEIGHT_TILES - 1)) / 10);
  return 0;
};

const riverWidening = (row: number): number => Math.floor(widening(row));

/**
 * First and last water column of a row for the visuals. Inside the farm they match the
 * server tiles but ignore the bridge rows, so the river runs under the deck.
 */
const riverSpanVisual = (row: number): [number, number] => {
  const column = row >= 0 && row < WORLD_HEIGHT_TILES ? riverColumnAt(row) : Math.round(riverCenterTile(row) - 1);
  const extra = riverWidening(row);
  return [column - extra, column + 2 + extra];
};

/** Half width of the visual river in tiles, measured from riverCenterTile. */
export const riverHalfWidthTiles = (ty: number): number => 1.5 + widening(ty);

const waterTile = (x: number, y: number): number => {
  const [first, last] = riverSpanVisual(y);
  return x >= first && x <= last ? 1 : 0;
};

const splineWeights = (t: number, out: number[]): void => {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = (1 - t) * (1 - t) * (1 - t) / 6;
  out[1] = (3 * t3 - 6 * t2 + 4) / 6;
  out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  out[3] = t3 / 6;
};

const weightsX = [0, 0, 0, 0];
const weightsY = [0, 0, 0, 0];

/** Cubic B-spline of the water tile mask: 0.5 on the tile edge of the river, rounded at the corners. */
export const waterField = (tx: number, ty: number): number => {
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  splineWeights(tx - x0, weightsX);
  splineWeights(ty - y0, weightsY);
  let sum = 0;
  for (let j = 0; j < 4; j += 1) {
    const row = y0 - 1 + j;
    let rowSum = 0;
    if (row < 0 || row >= WORLD_HEIGHT_TILES) {
      rowSum = smoothstep(-1.2, 1.2, riverHalfWidthTiles(row) - Math.abs(tx - riverCenterTile(row)));
    } else {
      const [first, last] = riverSpanVisual(row);
      for (let i = 0; i < 4; i += 1) {
        const x = x0 - 1 + i;
        if (x >= first && x <= last) rowSum += weightsX[i];
      }
    }
    sum += rowSum * weightsY[j];
  }
  return sum;
};

export const isVisualWaterTile = (x: number, y: number): boolean => waterTile(x, y) === 1;

/** The arched bridge spans rows 29-30 across the river. Bounds in world units. */
export const BRIDGE = {
  x0: tileToWorldX(38.5),
  x1: tileToWorldX(45.5),
  z0: tileToWorldZ(28.5),
  z1: tileToWorldZ(30.5),
  rise: 1.75
};

const riversideCenter = (ty: number): number => riverCenterTile(ty) - 3.6;

const ROAD_SPURS: Array<[number, number, number, number]> = [
  [8.6, 18.3, 9.4, 23.5], [9.4, 23.5, 10.2, 28.8],
  [64.6, 25.3, 64.2, 28.8],
  [30.2, 43.2, 30.8, 36.5], [30.8, 36.5, 31.4, 30.3],
  [4.2, 29.5, 1.5, 29.5]
];

/** 0..1 coverage of the walking paths (dirt and gravel). */
export const pathMask = (tx: number, ty: number): number => {
  if (farmSignedDistance(tx, ty) > 1.5) return 0;
  const wobble = Math.sin(tx * 0.17) * 0.55 * smoothstep(3, 9, Math.abs(tx - 42));
  const road = 1 - smoothstep(0.75, 1.15, Math.abs(ty - (29.5 + wobble)));
  const onRoadSpan = tx > 1.5 && tx < 77 ? 1 : 0;
  let best = road * onRoadSpan;
  if (ty > 3 && ty < 57) {
    const riverside = 1 - smoothstep(0.42, 0.78, Math.abs(tx - riversideCenter(ty)));
    best = Math.max(best, riverside);
  }
  for (const [ax, ay, bx, by] of ROAD_SPURS) {
    best = Math.max(best, 1 - smoothstep(0.45, 0.8, distanceToSegment(tx, ty, ax, ay, bx, by)));
  }
  return best;
};

/** True when (tx, ty) lies within `margin` tiles of a building-like obstacle footprint. */
export const nearObstacle = (tx: number, ty: number, margin: number, kinds: readonly string[] = ["barn", "market", "house", "gate", "rock", "tree"]): boolean =>
  WORLD_OBSTACLES.some((obstacle) =>
    kinds.includes(obstacle.kind) &&
    tx >= obstacle.x - 0.5 - margin && tx <= obstacle.x + obstacle.width - 0.5 + margin &&
    ty >= obstacle.y - 0.5 - margin && ty <= obstacle.y + obstacle.height - 0.5 + margin
  );

/** Valley walls, mountains and the meadow, before the river is carved. */
const landHeight = (wx: number, wz: number, tx: number, ty: number): number => {
  const sd = farmSignedDistance(tx, ty) * TILE;
  const riverDx = Math.abs(wx - riverCenterWorld(wz));
  const meadow = (fbm(wx * 0.011 + 3.1, wz * 0.011 - 1.7, 4) - 0.5) * 1.7 + Math.min(riverDx, 110) * 0.012 + 0.55;
  const outside = Math.max(0, sd);
  const wall = 1.1 * smoothstep(-8, 5, sd) + 17 * (1 - Math.exp(-outside / 30)) + outside * 0.15;
  const peaks = ridged(wx * 0.0042 + 11.3, wz * 0.0042 - 4.2) * 150 * smoothstep(25, 320, outside);
  const lumps = (fbm(wx * 0.024 - 7.7, wz * 0.024 + 2.2, 3) - 0.45) * 9 * smoothstep(2, 40, outside);
  let land = meadow + wall + peaks + lumps;
  if (sd > -10) {
    const upstream = smoothstep(-90, -420, wz);
    const downstream = smoothstep(90, 420, wz);
    const scale = lerp(lerp(0.2, 0.62, upstream), 0.12, downstream);
    const flat = 8 + widening(ty) * TILE;
    const corridor = WATER_LEVEL + 0.7 + Math.pow(Math.max(0, riverDx - flat), 1.22) * scale + (fbm(wx * 0.03, wz * 0.03, 3) - 0.5) * 2.2;
    land = Math.min(land, lerp(land, corridor, smoothstep(-10, 12, sd)));
  }
  return land;
};

/** Analytic ground: valley, river banks and the riverbed. Prefer `groundHeight`, which is cached. */
export const computeGroundHeight = (wx: number, wz: number): number => {
  const { x: tx, y: ty } = worldToTile(wx, wz);
  let land = landHeight(wx, wz, tx, ty);
  const center = riverCenterTile(ty);
  const fromEdge = Math.abs(tx - center) - riverHalfWidthTiles(ty);
  if (fromEdge < 4.5) {
    const bank = WATER_LEVEL + 0.22 + fbm(wz * 0.018 + (tx > center ? 40 : 0), 3.3, 3) * 1.05;
    land = lerp(land, Math.min(land, bank), smoothstep(4, 0.4, fromEdge));
    const field = waterField(tx, ty);
    if (field > 0.004) {
      if (field <= 0.5) {
        const t = smoothstep(0, 0.5, field);
        return lerp(land, WATER_LEVEL - 0.05, Math.pow(t, 1.15));
      }
      const pebbles = (valueNoise(wx * 1.7, wz * 1.7) - 0.5) * 0.06;
      return WATER_LEVEL - 0.05 - 1.55 * smoothstep(0.5, 1, field) + pebbles;
    }
  }
  return land;
};

/** Cached ground heights around the farm, one sample per world unit. */
export const HEIGHT_CACHE = { x0: -170, z0: -140, size: 1, columns: 341, rows: 281 };
let heightCache: Float32Array | undefined;

const ensureHeightCache = (): Float32Array => {
  if (heightCache) return heightCache;
  const { x0, z0, size, columns, rows } = HEIGHT_CACHE;
  const cache = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cache[row * columns + column] = computeGroundHeight(x0 + column * size, z0 + row * size);
    }
  }
  heightCache = cache;
  return cache;
};

/** Ground height; bilinear over the cache near the farm, analytic farther out. */
export const groundHeight = (wx: number, wz: number): number => {
  const { x0, z0, size, columns, rows } = HEIGHT_CACHE;
  const gx = (wx - x0) / size;
  const gz = (wz - z0) / size;
  if (gx < 0 || gz < 0 || gx >= columns - 1 || gz >= rows - 1) return computeGroundHeight(wx, wz);
  const cache = ensureHeightCache();
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const index = iz * columns + ix;
  const a = cache[index];
  const b = cache[index + 1];
  const c = cache[index + columns];
  const d = cache[index + columns + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
};

let bridgeEnds: [number, number] | undefined;

/** Height of the bridge walkway at `wx`, or undefined outside its footprint. */
export const bridgeDeckHeight = (wx: number, wz: number): number | undefined => {
  if (wx < BRIDGE.x0 || wx > BRIDGE.x1 || wz < BRIDGE.z0 || wz > BRIDGE.z1) return undefined;
  if (!bridgeEnds) {
    const zMid = (BRIDGE.z0 + BRIDGE.z1) / 2;
    bridgeEnds = [Math.max(groundHeight(BRIDGE.x0, zMid), WATER_LEVEL + 0.35), Math.max(groundHeight(BRIDGE.x1, zMid), WATER_LEVEL + 0.35)];
  }
  const u = (wx - BRIDGE.x0) / (BRIDGE.x1 - BRIDGE.x0);
  return lerp(bridgeEnds[0], bridgeEnds[1], u) + BRIDGE.rise * Math.sin(Math.PI * u) + 0.08;
};

/** Where feet rest: the bridge deck, the bank, or the bed of the shallows. */
export const walkHeight = (wx: number, wz: number): number => {
  const ground = groundHeight(wx, wz);
  const deck = bridgeDeckHeight(wx, wz);
  if (deck !== undefined) return Math.max(ground, deck);
  return Math.max(ground, WATER_LEVEL - 0.14);
};

export const sampleHeight = (x: number, y: number): number => walkHeight(tileToWorldX(x), tileToWorldZ(y));

export const tileToWorld = (x: number, y: number): { x: number; y: number; z: number } => {
  const wx = tileToWorldX(x);
  const wz = tileToWorldZ(y);
  return { x: wx, y: walkHeight(wx, wz), z: wz };
};

/** Numerical surface normal of the ground. */
export const groundNormal = (wx: number, wz: number, step = 0.6): { x: number; y: number; z: number } => {
  const hx = groundHeight(wx + step, wz) - groundHeight(wx - step, wz);
  const hz = groundHeight(wx, wz + step) - groundHeight(wx, wz - step);
  const nx = -hx;
  const ny = 2 * step;
  const nz = -hz;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
};
