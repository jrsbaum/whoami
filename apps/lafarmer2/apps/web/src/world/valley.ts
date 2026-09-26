import {
  PALETTE,
  WORLD_HEIGHT_TILES,
  WORLD_OBSTACLES,
  WORLD_WIDTH_TILES,
  isInsideFarmBoundary,
  isWorldWaterTile
} from "@lafarmer2/content";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { TILE, WATER_LEVEL, sampleHeight, tileToWorld, worldToTile } from "./height";

export type DayMood = {
  name: string;
  daylight: number;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  exposure: number;
  elevation: number;
  azimuth: number;
};

const CYCLE_MS = 90_000;

const mood = (name: string, daylight: number, sun: string, fog: string, top: string, horizon: string, exposure: number, elevation: number, azimuth: number): DayMood => ({
  name,
  daylight,
  sunColor: new THREE.Color(sun),
  fogColor: new THREE.Color(fog),
  skyTop: new THREE.Color(top),
  skyHorizon: new THREE.Color(horizon),
  exposure,
  elevation,
  azimuth
});

const MOODS: DayMood[] = [
  mood("Amanhecer", 0.55, "#ffb37a", "#efd2b4", "#f3c7a0", "#ffe7c4", 1.05, 0.22, 0.4),
  mood("Meio-dia", 1, "#fff4d2", "#c9e4ef", "#7eb6e0", "#d7f0ea", 1.12, 1.15, 0.15),
  mood("Fim de tarde", 0.72, "#ff8a3d", "#e7b089", "#f08a55", "#ffd0a0", 1.02, 0.28, -0.7),
  mood("Noite", 0.16, "#c9d7ff", "#1c3148", "#07111f", "#243852", 0.72, 0.35, 2.4)
];

export const dayMood = (now: number): DayMood => {
  const slice = ((now % CYCLE_MS) / CYCLE_MS) * MOODS.length;
  const index = Math.floor(slice) % MOODS.length;
  const next = MOODS[(index + 1) % MOODS.length];
  const current = MOODS[index];
  const t = slice - Math.floor(slice);
  return {
    name: t < 0.82 ? current.name : next.name,
    daylight: THREE.MathUtils.lerp(current.daylight, next.daylight, t),
    sunColor: current.sunColor.clone().lerp(next.sunColor, t),
    fogColor: current.fogColor.clone().lerp(next.fogColor, t),
    skyTop: current.skyTop.clone().lerp(next.skyTop, t),
    skyHorizon: current.skyHorizon.clone().lerp(next.skyHorizon, t),
    exposure: THREE.MathUtils.lerp(current.exposure, next.exposure, t),
    elevation: THREE.MathUtils.lerp(current.elevation, next.elevation, t),
    azimuth: THREE.MathUtils.lerp(current.azimuth, next.azimuth, t)
  };
};

const hex = (value: string): number => Number(`0x${value.slice(1)}`);

const grassColor = new THREE.Color(PALETTE.grass);
const mossColor = new THREE.Color(PALETTE.moss);
const soilColor = new THREE.Color(PALETTE.soil);
const rockColor = new THREE.Color("#8d8678");
const sandColor = new THREE.Color("#e4d2a4");

const standard = (color: number, roughness = 0.86): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });

const wood = standard(hex(PALETTE.soil), 0.78);
const leaf = standard(hex(PALETTE.forest), 0.9);
const leafLight = standard(hex(PALETTE.moss), 0.88);
const stone = standard(0x7d8480, 0.94);
const plank = standard(0x8a6238, 0.8);
const marketWall = standard(hex(PALETTE.amber), 0.74);
const houseWall = standard(hex(PALETTE.coral), 0.76);
const roofMarket = standard(0xd86b5d, 0.7);
const roofHouse = standard(0xa7473f, 0.72);

const skyShader = {
  uniforms: {
    uTop: { value: new THREE.Color("#7eb6e0") },
    uHorizon: { value: new THREE.Color("#d7f0ea") },
    uDaylight: { value: 1 }
  },
  vertexShader: `
    out vec3 vPosition;
    void main() {
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    in vec3 vPosition;
    uniform vec3 uTop;
    uniform vec3 uHorizon;
    uniform float uDaylight;
    out vec4 fragColor;
    void main() {
      vec3 dir = normalize(vPosition);
      float height = smoothstep(-0.05, 0.72, dir.y);
      vec3 color = mix(uHorizon, uTop, height);
      float star = step(0.9975, fract(sin(dot(floor(dir.xy * 90.0), vec2(12.9898, 78.233))) * 43758.5453));
      color += vec3(star * (1.0 - uDaylight) * 0.85);
      fragColor = vec4(color, 1.0);
    }
  `
};

const grassShader = {
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime;
    out vec3 vColor;
    void main() {
      vec3 pos = position;
      float sway = sin(uTime * 1.7 + instanceMatrix[3].x * 0.45 + instanceMatrix[3].z * 0.2) * pos.y;
      pos.x += sway * 0.28;
      pos.z += sway * 0.12;
      vec4 world = instanceMatrix * vec4(pos, 1.0);
      vColor = mix(vec3(0.45, 0.62, 0.32), vec3(0.62, 0.78, 0.4), clamp(pos.y, 0.0, 1.0));
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    in vec3 vColor;
    out vec4 fragColor;
    void main() {
      fragColor = vec4(vColor, 1.0);
    }
  `
};

const waterShader = {
  uniforms: {
    uTime: { value: 0 },
    uReflection: { value: null as THREE.Texture | null },
    uShallow: { value: new THREE.Color(PALETTE.riverLight) },
    uDeep: { value: new THREE.Color("#1d5c6b") },
    uResolution: { value: new THREE.Vector2(512, 512) }
  },
  vertexShader: `
    out vec3 vWorld;
    out vec3 vNormal;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform sampler2D uReflection;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform vec2 uResolution;
    in vec3 vWorld;
    in vec3 vNormal;
    out vec4 fragColor;
    void main() {
      float wave = sin(vWorld.x * 1.8 + uTime * 1.4) * cos(vWorld.z * 1.3 - uTime);
      vec2 uv = gl_FragCoord.xy / uResolution;
      uv.x += wave * 0.012;
      uv.y = 1.0 - uv.y + wave * 0.008;
      vec3 reflected = texture(uReflection, uv).rgb;
      float fresnel = pow(1.0 - clamp(abs(vNormal.y), 0.0, 1.0), 1.4);
      vec3 body = mix(uShallow, uDeep, 0.62);
      vec3 color = mix(body, reflected, 0.28 + fresnel * 0.35);
      color += vec3(0.85, 0.95, 0.9) * smoothstep(0.72, 1.0, wave) * 0.18;
      fragColor = vec4(color, 0.9);
    }
  `
};

const place = (x: number, y: number): THREE.Vector3 => {
  const point = tileToWorld(x, y);
  return new THREE.Vector3(point.x, point.y, point.z);
};

const tuftGeometry = (): THREE.BufferGeometry => {
  const blade = new THREE.PlaneGeometry(0.22, 1.05, 1, 3);
  blade.translate(0, 0.52, 0);
  const cross = blade.clone();
  cross.rotateY(Math.PI / 2);
  return mergeGeometries([blade, cross]) ?? blade;
};

const latheTrunk = (): THREE.LatheGeometry => {
  const points: THREE.Vector2[] = [];
  for (let step = 0; step <= 8; step += 1) {
    const t = step / 8;
    const radius = 0.2 * (1 - t * 0.62) + Math.sin(t * 11) * 0.015;
    points.push(new THREE.Vector2(Math.max(0.04, radius), t * 1.35));
  }
  return new THREE.LatheGeometry(points, 8);
};

const createTree = (x: number, y: number, seed: number): THREE.Group => {
  const group = new THREE.Group();
  group.position.copy(place(x + 0.5, y + 0.5));
  group.rotation.z = Math.sin(seed) * 0.12;
  group.rotation.y = seed;
  const trunk = new THREE.Mesh(latheTrunk(), wood);
  trunk.castShadow = true;
  const canopyA = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), leaf);
  canopyA.position.set(-0.08, 1.35, 0.05);
  canopyA.scale.set(1, 0.82, 1);
  const canopyB = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 7), leafLight);
  canopyB.position.set(0.28, 1.55, -0.12);
  const canopyC = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 7), leaf);
  canopyC.position.set(-0.22, 1.7, 0.18);
  [canopyA, canopyB, canopyC].forEach((mesh) => { mesh.castShadow = true; });
  group.add(trunk, canopyA, canopyB, canopyC);
  return group;
};

const createBuilding = (kind: string, x: number, y: number, width: number, height: number): THREE.Group => {
  const group = new THREE.Group();
  const center = place(x + width / 2 - 0.5, y + height / 2 - 0.5);
  group.position.copy(center);
  const spanX = width * TILE * 0.82;
  const spanZ = height * TILE * 0.82;
  const isMarket = kind === "market";
  const wall = new THREE.Mesh(new THREE.BoxGeometry(spanX, 1.55, spanZ), isMarket ? marketWall : houseWall);
  wall.position.y = 0.78;
  wall.castShadow = true;
  wall.receiveShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(spanX, spanZ) * 0.72, 0.9, 4), isMarket ? roofMarket : roofHouse);
  roof.position.y = 1.9;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(spanX * 0.18, 0.7, 0.08), wood);
  door.position.set(0, 0.38, spanZ / 2 + 0.02);
  group.add(wall, roof, door);
  return group;
};

const createRock = (x: number, y: number, width: number, height: number): THREE.Group => {
  const group = new THREE.Group();
  group.position.copy(place(x + width / 2 - 0.5, y + height / 2 - 0.5));
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42), stone);
  rock.scale.set(width * 0.85, 0.7, height * 0.85);
  rock.position.y = 0.22;
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);
  return group;
};

const createDeck = (x: number, y: number, width: number, height: number): THREE.Group => {
  const group = new THREE.Group();
  const center = place(x + width / 2 - 0.5, y + height / 2 - 0.5);
  center.y = Math.max(center.y, WATER_LEVEL + 0.12);
  group.position.copy(center);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width * TILE * 0.96, 0.16, height * TILE * 0.96), plank);
  deck.castShadow = true;
  deck.receiveShadow = true;
  const railA = new THREE.Mesh(new THREE.BoxGeometry(width * TILE, 0.28, 0.08), wood);
  railA.position.set(0, 0.28, height * TILE * 0.42);
  const railB = railA.clone();
  railB.position.z *= -1;
  group.add(deck, railA, railB);
  return group;
};

const createTerrain = (): THREE.Mesh => {
  const segmentsX = WORLD_WIDTH_TILES * 2;
  const segmentsY = WORLD_HEIGHT_TILES * 2;
  const geometry = new THREE.PlaneGeometry(WORLD_WIDTH_TILES * TILE, WORLD_HEIGHT_TILES * TILE, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const tile = worldToTile(position.getX(index), position.getZ(index));
    const height = sampleHeight(tile.x, tile.y);
    position.setY(index, height);
    const bank = Math.abs(height - WATER_LEVEL) < 0.18;
    const path = isInsideFarmBoundary(tile.x, tile.y) && (Math.abs(tile.y - 29) < 1.2 || Math.abs(tile.x - 40) < 0.8);
    const ridge = !isInsideFarmBoundary(tile.x, tile.y);
    if (bank) color.copy(sandColor);
    else if (ridge) color.copy(rockColor).lerp(mossColor, 0.35);
    else if (path) color.copy(soilColor);
    else color.copy(grassColor).lerp(mossColor, (Math.sin(tile.x * 0.7) + 1) * 0.15);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
};

const createWater = (): THREE.Mesh => {
  const positions: number[] = [];
  const half = 1.85;
  for (let y = 0; y < WORLD_HEIGHT_TILES - 1; y += 1) {
    const centerA = 41 + Math.sin(y * 0.32) * 2.2 + 1;
    const centerB = 41 + Math.sin((y + 1) * 0.32) * 2.2 + 1;
    const corners = [
      [centerA - half, y],
      [centerA + half, y],
      [centerB + half, y + 1],
      [centerA - half, y],
      [centerB + half, y + 1],
      [centerB - half, y + 1]
    ];
    for (const [tileX, tileY] of corners) {
      const point = tileToWorld(tileX, tileY);
      positions.push(point.x, WATER_LEVEL, point.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    uniforms: waterShader.uniforms,
    vertexShader: waterShader.vertexShader,
    fragmentShader: waterShader.fragmentShader,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
};

const createGrass = (): THREE.InstancedMesh => {
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < WORLD_HEIGHT_TILES; y += 1) {
    for (let x = 0; x < WORLD_WIDTH_TILES; x += 1) {
      if (!isInsideFarmBoundary(x, y) || isWorldWaterTile(x, y)) continue;
      if (WORLD_OBSTACLES.some((obstacle) => x >= obstacle.x && x < obstacle.x + obstacle.width && y >= obstacle.y && y < obstacle.y + obstacle.height)) continue;
      if ((x * 2 + y) % 3 === 0) continue;
      spots.push({ x, y });
    }
  }
  const mesh = new THREE.InstancedMesh(tuftGeometry(), new THREE.ShaderMaterial({ uniforms: grassShader.uniforms, vertexShader: grassShader.vertexShader, fragmentShader: grassShader.fragmentShader, glslVersion: THREE.GLSL3, side: THREE.DoubleSide }), spots.length);
  const dummy = new THREE.Object3D();
  spots.forEach((spot, index) => {
    const point = place(spot.x + ((index * 17) % 5) * 0.12, spot.y + ((index * 13) % 5) * 0.1);
    dummy.position.copy(point);
    dummy.rotation.y = index * 0.7;
    const scale = 0.75 + (index % 5) * 0.08;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  return mesh;
};

const createSky = (): THREE.Mesh => {
  const material = new THREE.ShaderMaterial({
    uniforms: skyShader.uniforms,
    vertexShader: skyShader.vertexShader,
    fragmentShader: skyShader.fragmentShader,
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), material);
  mesh.frustumCulled = false;
  return mesh;
};

export type Valley = {
  terrain: THREE.Mesh;
  update: (now: number, focus: THREE.Vector3, renderer: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.PerspectiveCamera) => DayMood;
  dispose: () => void;
};

export const createValley = (scene: THREE.Scene): Valley => {
  const terrain = createTerrain();
  const water = createWater();
  const grass = createGrass();
  const sky = createSky();
  const hemi = new THREE.HemisphereLight(0xd7f0ea, 0x6d8a4e, 0.55);
  const sun = new THREE.DirectionalLight(0xfff4d2, 1.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.00035;
  scene.add(sky, hemi, sun, sun.target, terrain, grass, water);
  scene.fog = new THREE.FogExp2(0xc9e4ef, 0.008);

  for (const obstacle of WORLD_OBSTACLES) {
    if (obstacle.kind === "tree") scene.add(createTree(obstacle.x, obstacle.y, obstacle.x * 1.7 + obstacle.y));
    else if (obstacle.kind === "rock") scene.add(createRock(obstacle.x, obstacle.y, obstacle.width, obstacle.height));
    else if (obstacle.kind === "gate" || obstacle.kind === "bridge") scene.add(createDeck(obstacle.x, obstacle.y, obstacle.width, obstacle.height));
    else scene.add(createBuilding(obstacle.kind, obstacle.x, obstacle.y, obstacle.width, obstacle.height));
  }

  const reflection = new THREE.WebGLRenderTarget(512, 512);
  const mirror = new THREE.PerspectiveCamera(48, 1, 0.1, 240);
  const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL);
  const sunDirection = new THREE.Vector3();
  const reflected = new THREE.Vector3();

  const update = (now: number, focus: THREE.Vector3, renderer: THREE.WebGLRenderer, liveScene: THREE.Scene, view: THREE.PerspectiveCamera): DayMood => {
    const phase = dayMood(now);
    const seconds = now / 1000;
    grassShader.uniforms.uTime.value = seconds;
    waterShader.uniforms.uTime.value = seconds;
    skyShader.uniforms.uTop.value.copy(phase.skyTop);
    skyShader.uniforms.uHorizon.value.copy(phase.skyHorizon);
    skyShader.uniforms.uDaylight.value = phase.daylight;
    sun.color.copy(phase.sunColor);
    sun.intensity = 0.35 + phase.daylight * 1.25;
    hemi.intensity = 0.28 + phase.daylight * 0.4;
    hemi.color.copy(phase.skyHorizon);
    if (liveScene.fog instanceof THREE.FogExp2) liveScene.fog.color.copy(phase.fogColor);
    renderer.toneMappingExposure = phase.exposure;
    renderer.setClearColor(phase.skyHorizon, 1);
    sunDirection.set(Math.cos(phase.azimuth) * Math.cos(phase.elevation), Math.sin(phase.elevation), Math.sin(phase.azimuth) * Math.cos(phase.elevation));
    sun.position.copy(focus).addScaledVector(sunDirection, 28);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();

    water.visible = false;
    grass.visible = false;
    mirror.fov = view.fov;
    mirror.aspect = view.aspect;
    mirror.position.copy(view.position);
    mirror.position.y = WATER_LEVEL - (view.position.y - WATER_LEVEL);
    view.getWorldDirection(reflected);
    const look = view.position.clone().add(reflected);
    look.y = WATER_LEVEL - (look.y - WATER_LEVEL);
    mirror.up.set(0, -1, 0);
    mirror.lookAt(look);
    mirror.updateProjectionMatrix();
    const previousTarget = renderer.getRenderTarget();
    const previousClipping = renderer.clippingPlanes;
    renderer.clippingPlanes = [clip];
    renderer.setRenderTarget(reflection);
    renderer.clear();
    renderer.render(liveScene, mirror);
    renderer.setRenderTarget(previousTarget);
    renderer.clippingPlanes = previousClipping;
    water.visible = true;
    grass.visible = true;
    const material = water.material as THREE.ShaderMaterial;
    material.uniforms.uReflection.value = reflection.texture;
    material.uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    return phase;
  };

  const dispose = (): void => {
    reflection.dispose();
    terrain.geometry.dispose();
    water.geometry.dispose();
    grass.geometry.dispose();
    sky.geometry.dispose();
  };

  return { terrain, update, dispose };
};
