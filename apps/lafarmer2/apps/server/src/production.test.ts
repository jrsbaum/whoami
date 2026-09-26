import { describe, expect, it } from "vitest";
import { INVENTORY_CAPACITY } from "@lafarmer2/content";
import type { PlayerState } from "./domain.js";
import { GameService } from "./game-service.js";
import { createInMemoryRepositories } from "./in-memory-store.js";

function player(now: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1", accountId: "account-1", name: "Farmer", farmName: "Vale", specialization: "vegetables", plot: null,
    homeRegionId: "region-center", currentRegionId: "region-center", appearance: { clothing: "forest", hair: "short" }, coins: 1_000, inventory: {}, inventoryQualities: {}, inventoryCapacity: INVENTORY_CAPACITY,
    lastActiveAt: now, position: { x: 5, y: 5 }, ...overrides
  };
}

describe("generic production engine", () => {
  it("uses the same data-driven stage engine for a crop and an animal output", async () => {
    let now = 1_000_000;
    const repositories = createInMemoryRepositories();
    await repositories.players.insert(player(now, { inventory: { "tomato-seed": 1 } }));
    const game = new GameService(repositories, () => now);

    const tomato = await game.plant("player-1", { contentId: "tomato" });
    expect(tomato.stageId).toBe("soil");
    now += 600_000;
    expect((await game.snapshot("player-1")).farmItems.find((item) => item.id === tomato.id)?.stageId).toBe("sprout");
    now += 600_000;
    const ready = (await game.snapshot("player-1")).farmItems.find((item) => item.id === tomato.id);
    expect(ready?.ready).toBe(true);
    const harvest = await game.harvest("player-1", tomato.id);
    expect(harvest.inventory.tomato).toBe(1);

    await expect(game.adopt("player-1", { contentId: "dinosaur" })).rejects.toMatchObject({ code: "specialization_locked" });
  });

  it("adopts a cow only inside an animal pen when feed is in stock", async () => {
    let now = 4_000_000;
    const repositories = createInMemoryRepositories();
    await repositories.players.insert(player(now, { specialization: "dinosaurs", inventory: { feed: 1, "dinosaur-fossil": 1 }, position: { x: 14, y: 14 } }));
    const game = new GameService(repositories, () => now);

    await expect(game.adopt("player-1", { contentId: "cow", x: 16, y: 15 })).rejects.toMatchObject({ code: "structure_required" });
    await game.buildStructure("player-1", { type: "animal_pen", x: 12, y: 12 });
    const cow = await game.adopt("player-1", { contentId: "cow", x: 16, y: 15 });
    expect(cow.contentId).toBe("cow");
    expect(cow.stageId).toBe("baby");
    expect((await repositories.players.findById("player-1"))?.inventory.feed ?? 0).toBe(0);

    await expect(game.adopt("player-1", { contentId: "dinosaur", x: 16, y: 15 })).rejects.toMatchObject({ code: "structure_required" });
    await game.buildStructure("player-1", { type: "dinosaur_enclosure", x: 22, y: 12 });
    const dinosaur = await game.adopt("player-1", { contentId: "dinosaur", x: 26, y: 15 });
    expect(dinosaur.contentId).toBe("dinosaur");

    now += 3_600_000;
    const snapshot = await game.snapshot("player-1");
    const readyCow = snapshot.farmItems.find((item) => item.id === cow.id);
    expect(readyCow?.pendingQuantity).toBeGreaterThan(0);
    const collected = await game.collect("player-1", cow.id);
    expect(collected.inventory.milk).toBe(1);
  });

  it("materializes offline cycles, pauses at capacity and records wallet causes", async () => {
    let now = 2_000_000;
    const repositories = createInMemoryRepositories();
    await repositories.players.insert(player(now, { specialization: "fruits", inventory: { "orange-seed": 1 }, inventoryCapacity: 1 }));
    const game = new GameService(repositories, () => now);
    const tree = await game.plant("player-1", { contentId: "orange-tree" });
    now += 1_800_000;
    const firstReturn = await game.snapshot("player-1");
    expect(firstReturn.offlineProgress.completedCycles).toBe(1);
    expect(firstReturn.offlineProgress.coins).toBe(6);
    expect(firstReturn.farmItems.find((item) => item.id === tree.id)?.pendingQuantity).toBe(1);
    await game.harvest("player-1", tree.id);
    now += 1_200_000;
    const full = await game.snapshot("player-1");
    expect(full.offlineProgress.blockedByCapacity).toBe(1);
    await expect(game.harvest("player-1", tree.id)).rejects.toMatchObject({ code: "not_ready" });
    await game.createListing("player-1", { contentId: "orange", quantity: 1, unitPrice: 1 });
    expect((await game.snapshot("player-1")).farmItems.find((item) => item.id === tree.id)?.pendingQuantity).toBe(0);
    now += 1_200_000;
    expect((await game.snapshot("player-1")).farmItems.find((item) => item.id === tree.id)?.pendingQuantity).toBe(1);
    const wallet = await game.wallet("player-1");
    expect(wallet.some((entry) => entry.reason === "offline_reward" && entry.delta === 6)).toBe(true);
    game.markOnlineActivity("player-1");
    now += 60_000;
    await game.onlineTick("player-1");
    expect((await game.wallet("player-1")).some((entry) => entry.reason === "online_reward" && entry.delta === 2)).toBe(true);
  });

  it("keeps care, quality and visual variant state generic", async () => {
    let now = 3_000_000;
    const repositories = createInMemoryRepositories();
    await repositories.players.insert(player(now, { specialization: "dinosaurs", inventory: { "dinosaur-fossil": 1 } }));
    const game = new GameService(repositories, () => now);
    await game.buildStructure("player-1", { type: "dinosaur_enclosure", x: 12, y: 12 });
    const dinosaur = await game.adopt("player-1", { contentId: "dinosaur", x: 16, y: 15 });
    expect(dinosaur.appearanceVariantId).toBe("default");
    const cared = await game.care("player-1", dinosaur.id);
    expect(cared.careState).toBe("attended");
    expect(cared.quality).toBe("good");
    expect((await game.care("player-1", dinosaur.id)).quality).toBe("perfect");
  });
});
