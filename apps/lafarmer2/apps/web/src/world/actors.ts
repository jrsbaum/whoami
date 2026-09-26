import { PALETTE, type Clothing, type HairStyle } from "@lafarmer2/content";
import * as THREE from "three";
import { TILE, tileToWorld } from "./height";

const hex = (value: string): number => Number(`0x${value.slice(1)}`);

const material = (color: number, roughness = 0.72): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });

const skin = material(0xf0d2b0, 0.62);
const hairMat = material(0x2b1c12, 0.8);
const soil = material(hex(PALETTE.soil), 0.9);
const moss = material(hex(PALETTE.moss), 0.86);
const amber = material(hex(PALETTE.amber), 0.7);
const coral = material(hex(PALETTE.coral), 0.68);
const cream = material(0xf5eee0, 0.8);
const spot = material(0x3a2a16, 0.84);
const dinoGreen = material(0x5d9854, 0.78);
const fossil = material(0x8a7a5c, 0.9);
const egg = material(0xd8c48a, 0.55);

export const clothingColor = (clothing: Clothing): number =>
  clothing === "coral" ? hex(PALETTE.coral) : clothing === "river" ? hex(PALETTE.river) : hex(PALETTE.forest);

type Limbs = { leftLeg: THREE.Object3D; rightLeg: THREE.Object3D; leftArm: THREE.Object3D; rightArm: THREE.Object3D };

const limb = (color: THREE.Material, width: number, height: number, depth: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(width, height, 4, 8), color);
  mesh.castShadow = true;
  mesh.position.y = -height / 2;
  return mesh;
};

export const createFarmer = (clothing: Clothing, hair: HairStyle): THREE.Group => {
  const group = new THREE.Group();
  const cloth = material(clothingColor(clothing), 0.74);
  const leftLegPivot = new THREE.Group();
  const rightLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.12, 0.72, 0);
  rightLegPivot.position.set(0.12, 0.72, 0);
  leftLegPivot.add(limb(cloth, 0.07, 0.34, 0.07));
  rightLegPivot.add(limb(cloth, 0.07, 0.34, 0.07));
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.38, 4, 8), cloth);
  torso.position.y = 0.98;
  torso.castShadow = true;
  const leftArmPivot = new THREE.Group();
  const rightArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.28, 1.12, 0);
  rightArmPivot.position.set(0.28, 1.12, 0);
  leftArmPivot.add(limb(skin, 0.05, 0.28, 0.05));
  rightArmPivot.add(limb(skin, 0.05, 0.28, 0.05));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.y = 1.38;
  head.castShadow = true;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), hairMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.05, 1.4, 0.13);
  eyeR.position.set(0.05, 1.4, 0.13);
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(hair === "long" ? 0.18 : 0.15, 10, 8), hairMat);
  hairMesh.position.y = hair === "long" ? 1.46 : 1.5;
  hairMesh.scale.set(1, hair === "long" ? 1.45 : 0.62, 1);
  if (hair === "long") {
    const lockL = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.28, 3, 6), hairMat);
    const lockR = lockL.clone();
    lockL.position.set(-0.14, 1.22, 0.02);
    lockR.position.set(0.14, 1.22, 0.02);
    group.add(lockL, lockR);
  }
  group.add(leftLegPivot, rightLegPivot, torso, leftArmPivot, rightArmPivot, head, hairMesh, eyeL, eyeR);
  const limbs: Limbs = { leftLeg: leftLegPivot, rightLeg: rightLegPivot, leftArm: leftArmPivot, rightArm: rightArmPivot };
  group.userData.limbs = limbs;
  group.userData.animate = "walk";
  return group;
};

export const poseActor = (group: THREE.Object3D, time: number, moving: boolean): void => {
  const limbs = group.userData.limbs as Limbs | undefined;
  if (limbs) {
    const swing = moving ? Math.sin(time * 0.012) * 0.7 : Math.sin(time * 0.002) * 0.06;
    limbs.leftLeg.rotation.x = swing;
    limbs.rightLeg.rotation.x = -swing;
    limbs.leftArm.rotation.x = -swing * 0.65;
    limbs.rightArm.rotation.x = swing * 0.65;
    return;
  }
  if (group.userData.animate === "bob") {
    group.rotation.y = Math.sin(time * 0.001 + group.id) * 0.35;
    group.position.y = Number(group.userData.groundY ?? group.position.y) + Math.sin(time * 0.003 + group.id) * 0.04;
  }
};

const markGround = (group: THREE.Group, tileX: number, tileY: number): THREE.Group => {
  const point = tileToWorld(tileX, tileY);
  group.position.set(point.x, point.y, point.z);
  group.userData.groundY = point.y;
  return group;
};

const createCow = (): THREE.Group => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), cream);
  body.scale.set(1.35, 0.72, 0.78);
  body.position.y = 0.48;
  body.castShadow = true;
  const patch = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), spot);
  patch.position.set(0.16, 0.58, 0.18);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), cream);
  head.position.set(0.42, 0.58, 0);
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 6), cream);
  [[-0.22, 0.16], [0.18, 0.16], [-0.22, -0.16], [0.18, -0.16]].forEach(([x, z]) => {
    const hoof = leg.clone();
    hoof.position.set(x, 0.18, z);
    hoof.castShadow = true;
    group.add(hoof);
  });
  group.add(body, patch, head);
  group.userData.animate = "bob";
  return group;
};

const createDinosaur = (visualKey: string): THREE.Group => {
  const group = new THREE.Group();
  if (visualKey.includes("fossil")) {
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 3, 6), fossil);
    bone.rotation.z = 0.6;
    bone.position.y = 0.16;
    group.add(bone);
    return group;
  }
  if (visualKey.includes("egg")) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), egg);
    shell.scale.y = 1.25;
    shell.position.y = 0.24;
    shell.castShadow = true;
    group.add(shell);
    return group;
  }
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.46, 4, 8), dinoGreen);
  body.rotation.z = Math.PI / 2;
  body.position.set(-0.05, 0.42, 0);
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), dinoGreen);
  head.position.set(0.38, 0.62, 0);
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.36, 3, 6), dinoGreen);
  tail.rotation.z = Math.PI / 2.4;
  tail.position.set(-0.42, 0.38, 0);
  group.add(body, head, tail);
  group.userData.animate = "bob";
  return group;
};

const createCrop = (visualKey: string, ready: boolean): THREE.Group => {
  const group = new THREE.Group();
  if (visualKey.includes("tree")) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 7), soil);
    trunk.position.y = 0.35;
    trunk.castShadow = true;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(ready || visualKey.includes("producing") ? 0.48 : 0.32, 10, 8), ready ? amber : moss);
    canopy.position.y = 0.95;
    canopy.castShadow = true;
    group.add(trunk, canopy);
    return group;
  }
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.1, 8), soil);
  mound.position.y = 0.05;
  group.add(mound);
  if (visualKey.includes("soil") && !visualKey.includes("sapling")) return group;
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(ready ? 0.2 : 0.12, ready ? 0.55 : 0.36, 7), ready ? coral : moss);
  leaf.position.y = ready ? 0.38 : 0.26;
  leaf.castShadow = true;
  group.add(leaf);
  if (ready && !visualKey.includes("sprout")) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), coral);
    fruit.position.set(0.1, 0.48, 0.06);
    group.add(fruit);
  }
  return group;
};

export const createFarmItemMesh = (visualKey: string, contentId: string, ready: boolean, tileX: number, tileY: number): THREE.Group => {
  const group = contentId === "cow" || visualKey.startsWith("cow")
    ? createCow()
    : contentId === "dinosaur" || visualKey.startsWith("dinosaur")
      ? createDinosaur(visualKey)
      : createCrop(visualKey, ready);
  if (ready) group.scale.setScalar(group.userData.animate === "bob" ? 1.05 : 1);
  return markGround(group, tileX, tileY);
};

export const createStructureMesh = (type: string, footprint: Array<[number, number]>): THREE.Group => {
  const xs = footprint.map((point) => point[0]);
  const ys = footprint.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const group = new THREE.Group();
  const center = tileToWorld((minX + maxX) / 2, (minY + maxY) / 2);
  group.position.set(center.x, center.y, center.z);
  const width = Math.max(1, maxX - minX) * TILE;
  const depth = Math.max(1, maxY - minY) * TILE;
  const color = type === "dinosaur_enclosure" ? 0xb47b48 : type === "orchard" ? 0x72a95d : type === "animal_pen" ? 0xc4a574 : 0xd4ae69;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.08, depth * 0.92), material(color, 0.9));
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), material(hex(PALETTE.soil)));
  [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].forEach(([sx, sz]) => {
    const pile = post.clone();
    pile.position.set(sx * width * 0.42, 0.35, sz * depth * 0.42);
    pile.castShadow = true;
    group.add(pile);
  });
  group.add(floor);
  return group;
};

/** Yaw for a mesh whose face points along local +Z. 0 looks south. */
export const facingYaw = (direction: "up" | "down" | "left" | "right"): number => {
  if (direction === "right") return Math.PI / 2;
  if (direction === "left") return -Math.PI / 2;
  if (direction === "up") return Math.PI;
  return 0;
};
