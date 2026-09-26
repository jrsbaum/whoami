import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { adoptGlobals } from "./shared";

/** Static files under `apps/web/public/valley/`. */
export const ASSET_ROOT = `${import.meta.env.BASE_URL}valley/`;

let requested = 0;
let settled = 0;
let waiters: Array<() => void> = [];
let maxAnisotropy = 8;

const track = (): (() => void) => {
  requested += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    settled += 1;
    if (settled < requested) return;
    const ready = waiters;
    waiters = [];
    ready.forEach((resolve) => resolve());
  };
};

/** Must run once the renderer exists and before the first texture is requested. */
export const configureAssets = (renderer: THREE.WebGLRenderer): void => {
  maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
};

/** 0..1 share of the requested files that finished (or failed). */
export const assetProgress = (): number => (requested === 0 ? 1 : settled / requested);

/** Resolves when every file requested so far has settled. */
export const assetsSettled = (): Promise<void> =>
  settled >= requested ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve));

export type TextureOptions = { srgb?: boolean; clamp?: boolean };

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

/**
 * Returns at once; the image streams in. Textures are shared by path, so never change
 * `repeat`/`offset` on them: scale the UVs instead (`worldUV` or `uvScale` in materials.ts).
 */
export const loadTexture = (file: string, options: TextureOptions = {}): THREE.Texture => {
  const key = `${file}|${options.srgb ? "srgb" : "linear"}|${options.clamp ? "clamp" : "repeat"}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const done = track();
  const texture = textureLoader.load(`${ASSET_ROOT}${file}`, done, undefined, done);
  texture.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  textureCache.set(key, texture);
  return texture;
};

/** Poly Haven texture set in `valley/tex/<slug>_{diff,nor,arm}.webp`. */
export const SURFACES = {
  meadow: "sparse_grass",
  forestFloor: "forrest_ground_01",
  dirtPath: "stony_dirt_path",
  pebbles: "river_small_rocks",
  rock: "lichen_rock",
  mossyRock: "mossy_rock",
  soil: "farm_soil",
  sakuraBark: "sakura_bark",
  cedarBark: "japanese_cedar_bark",
  thatch: "thatch_roof_angled",
  hinoki: "hinoki_planks",
  cedarPlanks: "japanese_cedar_planks",
  plaster: "clay_plaster",
  stoneWall: "japanese_stone_wall",
  roofTiles: "grey_roof_tiles",
  bamboo: "bamboo_wall"
} as const;

export type SurfaceSlug = (typeof SURFACES)[keyof typeof SURFACES];

/** Slugs shipped with an ARM map (R ambient occlusion, G roughness, B metalness). */
const WITH_ARM = new Set<string>([
  SURFACES.thatch, SURFACES.hinoki, SURFACES.cedarPlanks, SURFACES.plaster,
  SURFACES.stoneWall, SURFACES.roofTiles, SURFACES.bamboo, SURFACES.mossyRock
]);

export type SurfaceMaps = { map: THREE.Texture; normalMap: THREE.Texture; armMap?: THREE.Texture };

export const surfaceMaps = (slug: SurfaceSlug): SurfaceMaps => ({
  map: loadTexture(`tex/${slug}_diff.webp`, { srgb: true }),
  normalMap: loadTexture(`tex/${slug}_nor.webp`),
  armMap: WITH_ARM.has(slug) ? loadTexture(`tex/${slug}_arm.webp`) : undefined
});

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map<string, Promise<THREE.Group>>();

/**
 * Loads `valley/models/<file>` once and hands out clones that share geometry and materials.
 * Materials already carry the shared uniforms; meshes cast and receive shadows.
 */
export const loadModel = (file: string): Promise<THREE.Group> => {
  let pending = modelCache.get(file);
  if (!pending) {
    const done = track();
    pending = gltfLoader.loadAsync(`${ASSET_ROOT}models/${file}`).then((gltf) => {
      const root = gltf.scene;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      adoptGlobals(root);
      return root;
    }).finally(done);
    modelCache.set(file, pending);
  }
  return pending.then((root) => root.clone(true));
};
