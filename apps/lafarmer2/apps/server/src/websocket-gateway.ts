import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { AuthService } from "./auth-service.js";
import { ONLINE_TICK_INTERVAL_MS, type GameService } from "./game-service.js";
import type { Direction } from "./domain.js";

type Client = WebSocket & { playerId?: string };
type Connection = { client: Client; onlineTimer: ReturnType<typeof setInterval> };

export function attachWebSocketGateway(server: Server, auth: AuthService, game: GameService): { close: () => Promise<void> } {
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<string, Connection>();
  const clients = new Map<string, Client>();
  const messageQueues = new Map<Client, Promise<void>>();

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return;
    const token = readToken(request, url);
    void auth.authenticate(token).then((player) => {
      if (!player) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (raw) => {
        wss.emit("connection", raw, request, player.id);
      });
    });
  });

  wss.on("connection", (raw: WebSocket, _request: IncomingMessage, playerId: string) => {
    const client = raw as Client;
    client.playerId = playerId;
    clients.set(playerId, client);
    game.markOnlineActivity(playerId);
    const onlineTimer = setInterval(() => void game.onlineTick(playerId).then((player) => send(client, { type: "wallet.updated", payload: { coins: player.coins } })), ONLINE_TICK_INTERVAL_MS);
    connections.set(playerId, { client, onlineTimer });
    void game.snapshot(playerId).then(async (snapshot) => { snapshot.presence = await game.worldPresence(new Set(connections.keys())); send(client, { type: "hello", snapshot }); broadcastExcept(playerId, { type: "player_joined", player: snapshot.player }); await broadcastPresence(); });

    client.on("message", (data) => {
      const previous = messageQueues.get(client) ?? Promise.resolve();
      const next = previous.then(() => handleMessage(client, data.toString())).catch(() => undefined);
      messageQueues.set(client, next);
    });
    client.on("close", () => {
      clearInterval(onlineTimer);
      messageQueues.delete(client);
      if (connections.get(playerId)?.client === client) {
        connections.delete(playerId);
        clients.delete(playerId);
        broadcastExcept(playerId, { type: "player_left", playerId });
        void broadcastPresence();
      }
    });
  });

  async function handleMessage(client: Client, raw: string): Promise<void> {
    game.markOnlineActivity(client.playerId!);
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      send(client, { type: "error", code: "invalid_json" });
      return;
    }
    if (!isSupportedMessage(message)) {
      send(client, { type: "error", code: "unsupported_message" });
      return;
    }
    try {
      if (isMoveMessage(message)) {
        const move = readPayload(message);
        const result = await game.move(client.playerId!, { actionId: String(move.actionId), direction: move.direction as Direction, sprint: move.sprint === true });
        send(client, { type: "move_ack", ...result });
        broadcastExcept(client.playerId!, { type: "player_moved", playerId: client.playerId, player: result.player });
      } else {
        const payload = readPayload(message);
        if (message.type === "snapshot.get") { await sendSnapshot(client); return; }
        if (message.type === "farm.plant") send(client, { type: "farm.updated", item: await game.plant(client.playerId!, { contentId: String(payload.contentId), x: payload.x === undefined ? undefined : Number(payload.x), y: payload.y === undefined ? undefined : Number(payload.y) }) });
        if (message.type === "farm.adopt") send(client, { type: "farm.updated", item: await game.adopt(client.playerId!, { contentId: String(payload.contentId), x: payload.x === undefined ? undefined : Number(payload.x), y: payload.y === undefined ? undefined : Number(payload.y) }) });
        if (message.type === "farm.care") send(client, { type: "farm.updated", item: await game.care(client.playerId!, String(payload.itemId)) });
        if (message.type === "farm.harvest") { const result = await game.harvest(client.playerId!, String(payload.itemId)); send(client, { type: "farm.harvested", ...result }); }
        if (message.type === "farm.collect") { const result = await game.collect(client.playerId!, String(payload.itemId)); send(client, { type: "farm.collected", ...result }); }
        if (message.type === "market.list") send(client, { type: "market.updated", listing: await game.createListing(client.playerId!, { contentId: String(payload.contentId), quantity: Number(payload.quantity), unitPrice: Number(payload.unitPrice) }) });
        if (message.type === "market.buy") { const result = await game.buyListing(client.playerId!, String(payload.listingId), String(payload.idempotencyKey ?? payload.actionId ?? "")); send(client, { type: "market.purchased", ...result }); }
        if (message.type === "farm.structure.build") send(client, { type: "farm.structure.built", structure: await game.buildStructure(client.playerId!, { type: String(payload.type) as never, x: payload.x === undefined ? undefined : Number(payload.x), y: payload.y === undefined ? undefined : Number(payload.y) }) });
        if (message.type === "world.region.enter") {
          const player = await game.enterRegion(client.playerId!, String(payload.regionId));
          send(client, { type: "world.region.entered", player });
          broadcastExcept(client.playerId!, { type: "player_region_changed", playerId: client.playerId, player });
          await broadcastPresence();
        }
        await sendSnapshot(client);
      }
    } catch (error) {
      send(client, { type: "error", code: error instanceof Error ? error.message : "move_failed" });
    }
  }

  function broadcastExcept(playerId: string, payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const [otherId, connection] of connections) {
      if (otherId !== playerId && connection.client.readyState === WebSocket.OPEN) connection.client.send(serialized);
    }
  }

  async function broadcastPresence(): Promise<void> {
    const presence = await game.worldPresence(new Set(connections.keys()));
    const serialized = JSON.stringify({ type: "world.presence", presence });
    for (const connection of connections.values()) if (connection.client.readyState === WebSocket.OPEN) connection.client.send(serialized);
  }

  async function sendSnapshot(client: Client): Promise<void> {
    if (!client.playerId) return;
    const snapshot = await game.snapshot(client.playerId);
    snapshot.presence = await game.worldPresence(new Set(connections.keys()));
    send(client, { type: "snapshot", snapshot });
  }

  return {
    close: async () => {
      for (const connection of connections.values()) { clearInterval(connection.onlineTimer); connection.client.close(); }
      connections.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  };
}

function readToken(request: IncomingMessage, url: URL): string {
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

function isMoveMessage(value: unknown): value is { type: "move"; actionId: string; direction: Direction; sprint?: boolean } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const payload = (message.payload && typeof message.payload === "object" ? message.payload : message) as Record<string, unknown>;
  return message.type === "move" && typeof payload.actionId === "string" && typeof payload.direction === "string";
}

function isSupportedMessage(value: unknown): value is Record<string, unknown> & { type: string } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return typeof message.type === "string" && ["move", "snapshot.get", "farm.plant", "farm.adopt", "farm.care", "farm.harvest", "farm.collect", "market.list", "market.buy", "farm.structure.build", "world.region.enter"].includes(message.type);
}

function readPayload(value: Record<string, unknown>): Record<string, unknown> {
  return value.payload && typeof value.payload === "object" ? value.payload as Record<string, unknown> : value;
}

function send(client: WebSocket, payload: unknown): void {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}
