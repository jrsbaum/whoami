import * as THREE from "three";
import { surfaceMaps, type SurfaceSlug } from "./assets";
import { after, withGlobals } from "./shared";

export type SurfaceOptions = {
  /** Multiplies the albedo. */
  color?: THREE.ColorRepresentation;
  /** Absolute roughness without an ARM map, multiplier of the map otherwise. */
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  /** Scales the mesh UVs in the shader, for geometry that keeps 0..1 UVs. */
  uvScale?: number | [number, number];
  side?: THREE.Side;
  /** Emissive tint that only glows once the lamps are lit (paper, windows). */
  nightGlow?: THREE.ColorRepresentation;
  vertexColors?: boolean;
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * PBR material from a Poly Haven set, sharing the valley uniforms (fog, lamps, wind).
 * Identical requests return the same material instance.
 */
export const surfaceMaterial = (slug: SurfaceSlug, options: SurfaceOptions = {}): THREE.MeshStandardMaterial => {
  const scale = typeof options.uvScale === "number" ? [options.uvScale, options.uvScale] : options.uvScale ?? [1, 1];
  const color = new THREE.Color(options.color ?? 0xffffff);
  const glow = options.nightGlow === undefined ? undefined : new THREE.Color(options.nightGlow);
  const id = [
    slug, color.getHexString(), options.roughness ?? "r", options.metalness ?? "m", options.normalScale ?? "n",
    scale.join("x"), options.side ?? THREE.FrontSide, glow?.getHexString() ?? "-", options.vertexColors ? "vc" : ""
  ].join("|");
  const cached = cache.get(id);
  if (cached) return cached;
  const maps = surfaceMaps(slug);
  const material = new THREE.MeshStandardMaterial({
    color,
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.armMap ?? null,
    aoMap: maps.armMap ?? null,
    roughness: options.roughness ?? (maps.armMap ? 1 : 0.85),
    metalness: options.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
    vertexColors: options.vertexColors ?? false
  });
  const normalScale = options.normalScale ?? 1;
  material.normalScale.set(normalScale, normalScale);
  if (glow) material.emissive.copy(glow);
  const uvScale = new THREE.Vector2(scale[0], scale[1]);
  const scaled = uvScale.x !== 1 || uvScale.y !== 1;
  withGlobals(material, `surface-${scaled ? "uv" : "plain"}-${glow ? "glow" : "day"}`, (shader) => {
    if (scaled) {
      shader.uniforms.uUvScale = { value: uvScale };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec2 uUvScale;")
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
  #ifdef USE_MAP
    vMapUv *= uUvScale;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv *= uUvScale;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv *= uUvScale;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv *= uUvScale;
  #endif`
        );
    }
    if (glow) shader.fragmentShader = after(shader.fragmentShader, "emissivemap_fragment", "totalEmissiveRadiance *= uLampOn;");
  });
  cache.set(id, material);
  return material;
};

/**
 * Plain PBR colour that still shares fog and lamps. `nightGlow` makes it glow after dusk
 * (lantern paper, lit windows); `glowStrength` scales that HDR glow for the bloom.
 */
export const tintMaterial = (
  color: THREE.ColorRepresentation,
  options: { roughness?: number; metalness?: number; side?: THREE.Side; nightGlow?: THREE.ColorRepresentation; glowStrength?: number; vertexColors?: boolean } = {}
): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.8,
    metalness: options.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
    vertexColors: options.vertexColors ?? false
  });
  if (options.nightGlow !== undefined) {
    material.emissive.set(options.nightGlow).multiplyScalar(options.glowStrength ?? 1);
    return withGlobals(material, "tint-glow", (shader) => {
      shader.fragmentShader = after(shader.fragmentShader, "emissivemap_fragment", "totalEmissiveRadiance *= uLampOn;");
    });
  }
  return withGlobals(material, "tint");
};

/**
 * Replaces the UVs with planar projections in object space so textures keep their
 * real-world size on boxes and extrusions of any proportion. `density` = repeats per unit.
 */
export const worldUV = (geometry: THREE.BufferGeometry, density = 0.5): THREE.BufferGeometry => {
  const position = geometry.getAttribute("position");
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    let u = x;
    let v = y;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    uv[index * 2] = u * density;
    uv[index * 2 + 1] = v * density;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
};
