import { describe, expect, it } from "vitest";
import { WATER_LEVEL, sampleHeight } from "./height";

describe("sampleHeight", () => {
  it("keeps the riverbed under the water and the bank above it", () => {
    const bed = sampleHeight(42, 10);
    const bank = sampleHeight(36, 10);
    expect(bed).toBeLessThan(WATER_LEVEL);
    expect(bank).toBeGreaterThan(WATER_LEVEL);
  });

  it("lifts the bridge deck back above the water", () => {
    expect(sampleHeight(42, 29)).toBeGreaterThan(WATER_LEVEL);
  });

  it("raises the ground outside the farm boundary", () => {
    expect(sampleHeight(1, 1)).toBeGreaterThan(sampleHeight(40, 30));
  });
});
