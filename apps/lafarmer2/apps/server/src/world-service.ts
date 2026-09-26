import { getWorldConnection, getWorldRegion, INITIAL_REGION_IDS, WORLD_CONNECTIONS, WORLD_REGIONS } from "@lafarmer2/content";
import type { LandOption, PlayerState } from "./domain.js";

export type WorldRegionStatus = "occupied" | "frontier" | "locked";

export type WorldOverviewRegion = {
  id: string;
  name: string;
  biome: string;
  feature: string;
  summary: string;
  fertility: number;
  polygon: readonly [number, number][];
  neighbors: readonly string[];
  status: WorldRegionStatus;
  occupiedBy: string | null;
  connectionId: string | null;
};

function occupiedRegions(players: PlayerState[], playerId: string): Map<string, PlayerState> {
  return new Map(players.filter((player) => player.id !== playerId && player.homeRegionId).map((player) => [player.homeRegionId!, player]));
}

function connectionBetween(fromRegionId: string, toRegionId: string) {
  return WORLD_CONNECTIONS.find((connection) =>
    (connection.fromRegionId === fromRegionId && connection.toRegionId === toRegionId) ||
    (connection.fromRegionId === toRegionId && connection.toRegionId === fromRegionId)
  );
}

export function buildLandOptions(players: PlayerState[], playerId: string): LandOption[] {
  const occupied = occupiedRegions(players, playerId);
  const candidates = occupied.size === 0
    ? INITIAL_REGION_IDS.map((id) => getWorldRegion(id)).filter((region): region is NonNullable<typeof region> => Boolean(region))
    : WORLD_REGIONS.filter((region) => !occupied.has(region.id) && [...occupied.keys()].some((occupiedId) => region.neighbors.includes(occupiedId)));

  return candidates.slice(0, 5).map((region) => {
    const adjacentOccupiedId = [...occupied.keys()].find((occupiedId) => region.neighbors.includes(occupiedId));
    const connection = adjacentOccupiedId ? connectionBetween(region.id, adjacentOccupiedId) : undefined;
    return {
      id: region.id,
      regionId: region.id,
      x: connection?.entry.x ?? 40,
      y: connection?.entry.y ?? 29,
      biome: region.biome,
      title: region.name,
      feature: region.feature,
      summary: region.summary,
      fertility: region.fertility,
      nearbyNeighbors: [...occupied.keys()].filter((occupiedId) => region.neighbors.includes(occupiedId)).length,
      polygon: region.polygon,
      connectionId: connection?.id ?? null,
      locked: false
    };
  });
}

export function buildWorldOverview(players: PlayerState[], playerId: string): WorldOverviewRegion[] {
  const occupied = occupiedRegions(players, playerId);
  const options = new Map(buildLandOptions(players, playerId).map((option) => [option.regionId, option]));
  return WORLD_REGIONS.map((region) => {
    const owner = occupied.get(region.id);
    const option = options.get(region.id);
    return {
      id: region.id,
      name: region.name,
      biome: region.biome,
      feature: region.feature,
      summary: region.summary,
      fertility: region.fertility,
      polygon: region.polygon,
      neighbors: region.neighbors,
      status: owner ? "occupied" : option ? "frontier" : "locked",
      occupiedBy: owner?.name ?? null,
      connectionId: option?.connectionId ?? null
    };
  });
}

export function isRegionAvailable(players: PlayerState[], playerId: string, regionId: string): boolean {
  return buildLandOptions(players, playerId).some((option) => option.regionId === regionId);
}

export function getConnection(fromRegionId: string, toRegionId: string) {
  const from = getWorldRegion(fromRegionId);
  return from?.neighbors.includes(toRegionId) ? connectionBetween(fromRegionId, toRegionId) : undefined;
}

export function regionExists(regionId: string): boolean {
  return Boolean(getWorldRegion(regionId));
}
