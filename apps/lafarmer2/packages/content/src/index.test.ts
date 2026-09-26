import { describe, expect, it } from "vitest";
import { CONTENT_CATALOG, getContentDefinition, MARKET_TILE, ORIGIN_SHOP_OFFERS, STARTING_COINS, validateContentCatalog } from "./index.js";

describe("content catalog", () => {
  it("contains the MVP content families", () => {
    expect(CONTENT_CATALOG.map((item) => item.id)).toEqual([
      "tomato",
      "orange-tree",
      "cow",
      "dinosaur"
    ]);
  });

  it("keeps growth visuals data-driven", () => {
    expect(getContentDefinition("dinosaur")?.stages.map((stage) => stage.visualKey)).toEqual([
      "dinosaur-fossil",
      "dinosaur-egg",
      "dinosaur-hatchling",
      "dinosaur-adult"
    ]);
    expect(STARTING_COINS).toBe(1_000);
    expect(MARKET_TILE.x).toBe(62);
    expect(MARKET_TILE.y).toBe(21);
    expect(ORIGIN_SHOP_OFFERS.some((offer) => offer.itemId === "feed" && offer.specialization === "dinosaurs")).toBe(true);
  });

  it("validates stages, inputs and outputs before content can be registered", () => {
    expect(() => validateContentCatalog(CONTENT_CATALOG)).not.toThrow();
    const invalid = [{ ...CONTENT_CATALOG[0], id: "broken", stages: [{ id: "soil", visualKey: "soil", durationSeconds: 1 }] }];
    expect(() => validateContentCatalog(invalid)).toThrow("invalid_initial_stage:broken");
  });
});
