import type { Clothing, HairStyle } from "@lafarmer2/content";
import * as THREE from "three";
import { createFarmer } from "./actors";

export const mountCharacterPreview = (host: HTMLElement, clothing: Clothing, hair: HairStyle): (() => void) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7e8c8);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3c8, 0.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const farmer = createFarmer(clothing, hair);
  scene.add(farmer);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  camera.position.set(0, 1.4, 3.2);
  camera.lookAt(0, 0.9, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(host.clientWidth || 220, host.clientHeight || 260, false);
  host.replaceChildren(renderer.domElement);
  let frame = 0;
  const tick = (): void => {
    farmer.rotation.y += 0.012;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    renderer.dispose();
    host.replaceChildren();
  };
};
