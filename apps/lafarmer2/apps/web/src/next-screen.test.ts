import { describe, expect, it } from "vitest";
import { isProfileComplete, nextScreenAfterAuth } from "./next-screen";

const ready = {
  name: "Jasmim",
  farmName: "Vale Jasmim",
  specialization: "vegetables" as const,
  homeRegionId: "region-center",
  plot: { id: "region-center" }
};

describe("nextScreenAfterAuth", () => {
  it("sends a new registration to credential confirmation only", () => {
    expect(nextScreenAfterAuth(true, ready)).toBe("confirm");
    expect(nextScreenAfterAuth(true, { name: "a", farmName: "", specialization: null })).toBe("confirm");
  });

  it("sends a completed profile straight into the valley after login", () => {
    expect(isProfileComplete(ready)).toBe(true);
    expect(nextScreenAfterAuth(false, ready)).toBe("game");
  });

  it("keeps incomplete profiles in onboarding", () => {
    expect(nextScreenAfterAuth(false, { ...ready, specialization: null })).toBe("onboarding");
    expect(nextScreenAfterAuth(false, { ...ready, farmName: "" })).toBe("onboarding");
    expect(nextScreenAfterAuth(false, { ...ready, homeRegionId: null, plot: null })).toBe("onboarding");
  });
});
