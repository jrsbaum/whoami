import * as THREE from "three";
import { WATER_LEVEL } from "./height";

/** Opaque geometry drawn in the main pass and in the water mirror. */
export const LAYER_MAIN = 0;
/** Water and late transparents, drawn after the scene copy so they can refract it. */
export const LAYER_WATER = 1;
/** Opaque geometry the mirror skips (grass, small ground cover, the player's feet dust). */
export const LAYER_NO_REFLECT = 2;

export const MAX_LAMPS = 8;

/**
 * One uniform object shared by every material in the valley. Materials receive these same
 * objects by reference, so the day cycle updates all of them in one place.
 */
export const GLOBALS = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.35, 0.42, -0.84).normalize() },
  uSunCol: { value: new THREE.Vector3(5.2, 3.7, 2.3) },
  uMoonDir: { value: new THREE.Vector3(-0.3, 0.6, 0.74).normalize() },
  uKeyDir: { value: new THREE.Vector3(0.35, 0.42, -0.84).normalize() },
  uNight: { value: 0 },
  uSunVis: { value: 1 },
  uSkyZen: { value: new THREE.Vector3(0.12, 0.24, 0.42) },
  uSkyHor: { value: new THREE.Vector3(0.62, 0.66, 0.66) },
  uHorizonGlow: { value: new THREE.Vector3(1, 0.62, 0.36) },
  uCloudLit: { value: new THREE.Vector3(1.35, 1.05, 0.8) },
  uCloudShade: { value: new THREE.Vector3(0.36, 0.38, 0.45) },
  uCloudCover: { value: 0.46 },
  uFogCool: { value: new THREE.Vector3(0.36, 0.45, 0.52) },
  uFogWarm: { value: new THREE.Vector3(1.02, 0.72, 0.45) },
  /** x: height-fog density at the base, y: height falloff, z: base height, w: distance haze. */
  uFogParams: { value: new THREE.Vector4(0.006, 0.05, WATER_LEVEL, 0.00045) },
  uMist: { value: 1 },
  /** xy: wind direction, z: strength, w: unused. */
  uWind: { value: new THREE.Vector4(0.8, 0.6, 1, 0) },
  uReflect: { value: 0 },
  uWaterLevel: { value: WATER_LEVEL },
  uPlayer: { value: new THREE.Vector3(0, -999, 0) },
  uAmbient: { value: new THREE.Vector3(1, 1, 1) },
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(1, 0.55, 0.24)) },
  uLampN: { value: 0 },
  uLampOn: { value: 0 },
  /** See groundMask.ts. */
  uGroundMask: { value: null as THREE.Texture | null },
  uGroundMaskRect: { value: new THREE.Vector4(0, 0, 0, 0) }
};

export type Globals = typeof GLOBALS;

export type Lamp = { position: THREE.Vector3; intensity: number; color: THREE.Color };

/** Every warm light in the valley. Only the MAX_LAMPS nearest the camera light the scene. */
export const LAMPS: Lamp[] = [];

/** `intensity` ~10 lights the ground three units around a lantern after dusk. */
export const addLamp = (position: THREE.Vector3, intensity = 10, color: THREE.ColorRepresentation = 0xff8c3d): Lamp => {
  const lamp = { position: position.clone(), intensity, color: new THREE.Color(color) };
  LAMPS.push(lamp);
  return lamp;
};

export const removeLamp = (lamp: Lamp): void => {
  const index = LAMPS.indexOf(lamp);
  if (index >= 0) LAMPS.splice(index, 1);
};

const lampOrder: Lamp[] = [];

export const updateLampUniforms = (focus: THREE.Vector3): void => {
  lampOrder.length = 0;
  lampOrder.push(...LAMPS);
  lampOrder.sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus));
  const count = Math.min(MAX_LAMPS, lampOrder.length);
  for (let index = 0; index < MAX_LAMPS; index += 1) {
    const lamp = lampOrder[index];
    if (index < count && lamp) {
      GLOBALS.uLamps.value[index].set(lamp.position.x, lamp.position.y, lamp.position.z, lamp.intensity);
      GLOBALS.uLampCol.value[index].set(lamp.color.r, lamp.color.g, lamp.color.b);
    } else {
      GLOBALS.uLamps.value[index].set(0, -999, 0, 0);
    }
  }
  GLOBALS.uLampN.value = count;
};

/** GLSL shared by every shader: declarations, noise, the wind field and the aerial perspective. */
export const PRELUDE = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uMoonDir;
uniform vec3 uKeyDir;
uniform float uNight;
uniform float uSunVis;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uHorizonGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform vec3 uFogCool;
uniform vec3 uFogWarm;
uniform vec4 uFogParams;
uniform float uMist;
uniform vec4 uWind;
uniform float uReflect;
uniform float uWaterLevel;
uniform vec3 uPlayer;
uniform vec3 uAmbient;
uniform vec4 uLamps[${MAX_LAMPS}];
uniform vec3 uLampCol[${MAX_LAMPS}];
uniform int uLampN;
uniform float uLampOn;
uniform sampler2D uGroundMask;
uniform vec4 uGroundMaskRect;

/** R: dirt path, G: tilled soil, B: bare ground without grass. Zero outside the farm region. */
vec4 groundMaskAt(vec2 xz) {
  vec2 uv = (xz - uGroundMaskRect.xy) * uGroundMaskRect.zw;
  if (uGroundMaskRect.z == 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uGroundMask, uv);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm3(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.28 + vnoise(p * 4.11 - 3.7) * 0.17;
}

float fbm5(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += vnoise(p) * amp;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    amp *= 0.5;
  }
  return sum / 0.96875;
}

/** Gust fronts roll across the valley along the wind direction. */
float windGust(vec3 wp) {
  vec2 d = uWind.xy;
  float along = dot(wp.xz, d);
  float g = 0.55 + 0.45 * sin(uTime * 0.55 - along * 0.045) * (0.6 + 0.4 * sin(uTime * 0.21 + wp.x * 0.013 - wp.z * 0.011));
  return max(g, 0.08) * uWind.z;
}

/** Displacement for anything that bends in the wind. flex grows toward branch tips and blade tops. */
vec3 windSway(vec3 wp, float flex, float phase) {
  float g = windGust(wp);
  float t = uTime;
  float s = sin(t * 1.35 + phase + dot(wp.xz, uWind.xy) * 0.09) * 0.55 + sin(t * 2.3 + phase * 1.9) * 0.22;
  vec3 dir = vec3(uWind.x, 0.0, uWind.y);
  vec3 side = vec3(-uWind.y, 0.0, uWind.x);
  return (dir * (0.55 + s) * g + side * sin(t * 1.7 + phase * 2.3) * 0.18 * g) * flex;
}

vec3 skyFogColor(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  float warm = clamp(pow(s, 2.6) * 0.95 + 0.05, 0.0, 1.0);
  vec3 c = mix(uFogCool, uFogWarm, warm * (1.0 - uNight));
  c += uSunCol * (pow(s, 12.0) * 0.07 + pow(s, 90.0) * 0.18) * uSunVis * (1.0 - uNight);
  return c;
}

/** Exponential height fog, distance haze and low river mist, lit by the sun. */
vec3 applyAtmosphere(vec3 col, vec3 wp) {
  vec3 ro = cameraPosition;
  if (uReflect > 0.5) ro.y = 2.0 * uWaterLevel - ro.y;
  vec3 dv = wp - ro;
  float dist = length(dv);
  vec3 rd = dv / max(dist, 1e-3);
  float fall = uFogParams.y;
  float k = fall * dv.y;
  float fh = uFogParams.x * exp(-fall * (ro.y - uFogParams.z)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
  float my = clamp(1.0 - (wp.y - uWaterLevel) / 6.0, 0.0, 1.0);
  vec2 mp = wp.xz * 0.032 + vec2(uTime * 0.045, uTime * 0.062);
  float mn = vnoise(mp) * 1.3 - 0.38;
  float mist = uMist * my * my * max(mn, 0.0) * min(dist, 150.0) * 0.0045;
  float haze = uFogParams.w * dist;
  float T = exp(-(fh + haze + mist));
  vec3 fc = skyFogColor(normalize(vec3(rd.x, max(rd.y, -0.05), rd.z)));
  fc += uSunCol * 0.04 * mist * pow(max(dot(rd, uSunDir), 0.0), 3.0) * (1.0 - uNight);
  return col * T + fc * (1.0 - T);
}
`;

/** Translucency terms for leaves and blades; expects gSunColor/gSunDir from the patched light loop. */
export const TRANSLUCENCY = /* glsl */ `
  vec3 sunLv = gSunDir;
  vec3 sunC = gSunColor;
  float sunBack = pow(saturate(dot(-normalize(vViewPosition), sunLv)), 4.0);
  float sunWrap = saturate(dot(-normal, sunLv) * 0.6 + 0.4);
`;

let installed = false;

/** Rewrites three's fog and light chunks once so every built-in material shares the atmosphere. */
export const installShaderChunks = (): void => {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk as Record<string, string>;
  chunk.common = `${chunk.common}\n${PRELUDE}`;
  chunk.fog_pars_vertex = `#ifdef USE_FOG
  varying vec3 vFogWP;
#endif`;
  chunk.fog_vertex = `#ifdef USE_FOG
  vec4 fogWP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    fogWP = batchingMatrix * fogWP;
  #endif
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWP = (modelMatrix * fogWP).xyz;
#endif`;
  chunk.fog_pars_fragment = `#ifdef USE_FOG
  varying vec3 vFogWP;
#endif`;
  chunk.fog_fragment = `#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vFogWP);
#endif`;
  chunk.lights_pars_begin = `${chunk.lights_pars_begin}
vec3 gSunColor = vec3(0.0);
vec3 gSunDir = vec3(0.0, 1.0, 0.0);
`;
  const marker = "getDirectionalLightInfo( directionalLight, directLight );";
  const at = chunk.lights_fragment_begin.indexOf(marker);
  if (at > 0) {
    const head = chunk.lights_fragment_begin.slice(0, at);
    const tail = chunk.lights_fragment_begin.slice(at).replace(
      "RE_Direct(",
      "if ( UNROLLED_LOOP_INDEX == 0 ) { gSunColor = directLight.color; gSunDir = directLight.direction; }\n\t\tRE_Direct("
    );
    chunk.lights_fragment_begin = head + tail;
  }
  chunk.lights_fragment_end = `
#if defined( USE_FOG ) && defined( RE_Direct )
  if (uLampOn > 0.001) {
    for (int li = 0; li < ${MAX_LAMPS}; li++) {
      if (li >= uLampN) break;
      vec4 lamp = uLamps[li];
      vec3 lv = lamp.xyz - vFogWP;
      float d2 = dot(lv, lv);
      if (d2 > 900.0) continue;
      IncidentLight lampLight;
      lampLight.direction = normalize((viewMatrix * vec4(lv, 0.0)).xyz);
      lampLight.color = uLampCol[li] * lamp.w * uLampOn / (d2 + 0.35) * (1.0 - smoothstep(380.0, 900.0, d2));
      lampLight.visible = true;
      RE_Direct( lampLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
  }
#endif
${chunk.lights_fragment_end}`;
};

type CompileHook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/** Gives a built-in material the shared uniforms. `key` must be unique per shader variant. */
export const withGlobals = <T extends THREE.Material>(material: T, key: string, hook?: CompileHook): T => {
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, GLOBALS);
    hook?.(shader, renderer);
  };
  material.customProgramCacheKey = () => key;
  material.userData.globals = true;
  return material;
};

/** Every material in `root` that has not been customised receives the shared uniforms. */
export const adoptGlobals = (root: THREE.Object3D): void => {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material.userData.globals) continue;
      if ((material as THREE.ShaderMaterial).isShaderMaterial) {
        const shaderMaterial = material as THREE.ShaderMaterial;
        Object.assign(shaderMaterial.uniforms, GLOBALS);
        material.userData.globals = true;
        continue;
      }
      withGlobals(material, "plain");
    }
  });
};

/** Replaces `#include <name>` with the include followed by `code`. */
export const after = (source: string, include: string, code: string): string =>
  source.replace(`#include <${include}>`, `#include <${include}>\n${code}`);

/** Replaces `#include <name>` with `code` followed by the include. */
export const before = (source: string, include: string, code: string): string =>
  source.replace(`#include <${include}>`, `${code}\n#include <${include}>`);
