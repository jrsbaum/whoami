import { isWorldTileWalkable } from "@lafarmer2/content";
import { describe, expect, it } from "vitest";
import { INITIAL_CAMERA_YAW, chooseWalk, rightFromYaw } from "./movement";

const walk = (x: number, y: number, yaw: number, forward: number, strafe: number, preferCrossAxis = false, sprint = false) =>
  chooseWalk({ x, y }, yaw, { forward, strafe }, preferCrossAxis, isWorldTileWalkable, sprint);

describe("camera-relative steps", () => {
  it("sends W along the camera forward and D along the screen-right", () => {
    expect(walk(20, 12, INITIAL_CAMERA_YAW, 1, 0)).toEqual({ direction: "right", x: 21, y: 12 });
    expect(walk(20, 12, INITIAL_CAMERA_YAW, 0, 1)).toEqual({ direction: "down", x: 20, y: 13 });
    expect(walk(20, 12, 0, 1, 0)).toEqual({ direction: "down", x: 20, y: 13 });
    expect(walk(20, 12, 0, 0, 1)).toEqual({ direction: "left", x: 19, y: 12 });
    expect(rightFromYaw(0)).toEqual({ x: -1, z: 0 });
  });

  it("alternates the two axes of a diagonal", () => {
    const along = walk(20, 12, INITIAL_CAMERA_YAW, 1, 1, false);
    const across = walk(20, 12, INITIAL_CAMERA_YAW, 1, 1, true);
    expect([along?.direction, across?.direction].sort()).toEqual(["down", "right"]);
  });

  it("sprints two free tiles and stops before a tree", () => {
    expect(walk(20, 12, INITIAL_CAMERA_YAW, 1, 0, false, true)).toEqual({ direction: "right", x: 22, y: 12 });
    expect(walk(10, 8, INITIAL_CAMERA_YAW, 1, 0)).toBeUndefined();
    expect(isWorldTileWalkable(11, 8)).toBe(false);
  });

  it("slides along the tree when the forward tile is blocked and strafe is held", () => {
    expect(walk(10, 8, INITIAL_CAMERA_YAW, 1, 1, true)).toEqual({ direction: "down", x: 10, y: 9 });
    expect(walk(10, 8, INITIAL_CAMERA_YAW, 1, 1, false)).toEqual({ direction: "down", x: 10, y: 9 });
  });
});
