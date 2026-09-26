export type Direction = "up" | "down" | "left" | "right";
export type Tile = { x: number; y: number };
export type PlanarInput = { forward: number; strafe: number };

export const WALK_TILES_PER_SECOND = 3.4;
export const SPRINT_TILES_PER_SECOND = 6.2;

/** Camera looks east at spawn, into the open meadow rather than at the valley center. */
export const INITIAL_CAMERA_YAW = Math.PI / 2;

/** Yaw for a mesh whose face points along local +Z. 0 looks south (+Z). */
export const yawForDirection = (direction: Direction): number => {
  if (direction === "right") return Math.PI / 2;
  if (direction === "left") return -Math.PI / 2;
  if (direction === "up") return Math.PI;
  return 0;
};

export const forwardFromYaw = (yaw: number): { x: number; z: number } => ({
  x: Math.sin(yaw),
  z: Math.cos(yaw)
});

/** Screen-right while the camera looks along `forwardFromYaw` with Y up. */
export const rightFromYaw = (yaw: number): { x: number; z: number } => {
  const forward = forwardFromYaw(yaw);
  return { x: -forward.z, z: forward.x };
};

export const directionFromYaw = (yaw: number): Direction => {
  const forward = forwardFromYaw(yaw);
  if (Math.abs(forward.x) >= Math.abs(forward.z)) return forward.x >= 0 ? "right" : "left";
  return forward.z >= 0 ? "down" : "up";
};

const cardinal = (x: number, z: number, preferX: boolean): Direction => {
  const horizontal: Direction = x >= 0 ? "right" : "left";
  const vertical: Direction = z >= 0 ? "down" : "up";
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > 0.35 && az > 0.35) return preferX ? horizontal : vertical;
  return ax >= az ? horizontal : vertical;
};

const stepOnce = (origin: Tile, direction: Direction): Tile => {
  if (direction === "right") return { x: origin.x + 1, y: origin.y };
  if (direction === "left") return { x: origin.x - 1, y: origin.y };
  if (direction === "down") return { x: origin.x, y: origin.y + 1 };
  return { x: origin.x, y: origin.y - 1 };
};

/**
 * One authoritative tile step, relative to the camera.
 * W is `forward` (into the screen). A/D strafe. Diagonals alternate axes.
 * A blocked axis falls through to the other held axis so the farmer slides along a tree.
 */
export const chooseWalk = (
  origin: Tile,
  yaw: number,
  input: PlanarInput,
  preferCrossAxis: boolean,
  walkable: (x: number, y: number) => boolean,
  sprint: boolean
): { direction: Direction; x: number; y: number } | undefined => {
  const forward = forwardFromYaw(yaw);
  const right = rightFromYaw(yaw);
  const x = forward.x * input.forward + right.x * input.strafe;
  const z = forward.z * input.forward + right.z * input.strafe;
  if (Math.hypot(x, z) < 0.2) return undefined;
  const primary = cardinal(x, z, preferCrossAxis);
  const secondary = cardinal(x, z, !preferCrossAxis);
  const options = primary === secondary ? [primary] : [primary, secondary];
  for (const direction of options) {
    let cursor = origin;
    const maxSteps = sprint ? 2 : 1;
    for (let step = 0; step < maxSteps; step += 1) {
      const candidate = stepOnce(cursor, direction);
      if (!walkable(candidate.x, candidate.y)) break;
      cursor = candidate;
    }
    if (cursor.x !== origin.x || cursor.y !== origin.y) return { direction, x: cursor.x, y: cursor.y };
  }
  return undefined;
};
