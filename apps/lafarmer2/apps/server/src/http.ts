import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createDefaultAppearance, CONTENT_CATALOG, ITEM_CATALOG, isClothing, isHairStyle } from "@lafarmer2/content";
import { z } from "zod";
import { AuthError, AuthService, PASSWORD_MIN_LENGTH } from "./auth-service.js";
import { GameError, GameService } from "./game-service.js";
import type { RepositoryBundle } from "./repositories.js";
import { createPersistence } from "./persistence.js";
import { attachWebSocketGateway } from "./websocket-gateway.js";

const registerSchema = z.object({ nick: z.string(), password: z.string(), credentialsSaved: z.literal(true) });
const loginSchema = z.object({ nick: z.string(), password: z.string() });
const profileSchema = z.object({
  name: z.string(),
  clothing: z.string().refine(isClothing),
  hair: z.string().refine(isHairStyle),
  farmName: z.string().max(32).optional(),
  specialization: z.enum(["fruits", "vegetables", "dinosaurs"]).optional(),
  plotId: z.string().optional()
});
const marketPurchaseSchema = z.object({ idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/).optional() });

export type ServerOptions = {
  repositories?: RepositoryBundle;
  logger?: boolean;
  databaseUrl?: string;
  environment?: string;
};

export function createApp(options: ServerOptions = {}): FastifyInstance {
  const persistence = createPersistence({
    repositories: options.repositories,
    databaseUrl: options.databaseUrl,
    environment: options.environment
  });
  const auth = new AuthService(persistence.repositories);
  const game = new GameService({ players: persistence.repositories.players, farm: persistence.repositories.farm, structures: persistence.repositories.structures, market: persistence.repositories.market, wallet: persistence.repositories.wallet });
  const app = Fastify({ logger: options.logger ?? false });
  app.addHook('onRequest', async (request, reply) => {
    const allowedOrigin = process.env.CORS_ORIGIN ?? request.headers.origin ?? '';
    if (allowedOrigin) reply.header('access-control-allow-origin', allowedOrigin);
    reply.header('access-control-allow-headers', 'content-type, authorization, idempotency-key');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  const websocket = attachWebSocketGateway(app.server, auth, game);

  app.addHook("onReady", async () => persistence.initialize());
  app.addHook("onClose", async () => websocket.close());
  app.addHook("onClose", async () => persistence.close());

  app.get("/healthz", async () => ({ status: "ok", service: "lafarmer2-server" }));
  app.get("/api/catalog", async () => ({ items: CONTENT_CATALOG, inventoryItems: ITEM_CATALOG }));

  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_registration", passwordMinLength: PASSWORD_MIN_LENGTH });
    try {
      return reply.code(201).send(await auth.register(parsed.data));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_login" });
    try {
      return reply.send(await auth.login(parsed.data));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/api/me", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ player });
  });

  app.get("/api/world/snapshot", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try {
      return reply.send(await game.snapshot(player.id));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/api/wallet", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ entries: await game.wallet(player.id) });
  });

  app.patch("/api/player/profile", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_profile" });
    try {
      return reply.send({ player: await auth.updateProfile(player.id, parsed.data) });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/api/world/land-options", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ options: await auth.landOptions(player.id) });
  });

  app.get("/api/world/frontier-options", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ options: await auth.landOptions(player.id) });
  });

  app.get("/api/world/overview", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ regions: await auth.worldOverview(player.id) });
  });

  app.post("/api/world/region/reserve", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ regionId: z.string() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_land" });
    try { return reply.send(await auth.reserveRegion(player.id, parsed.data.regionId)); } catch (error) { return sendDomainError(reply, error); }
  });

  app.get("/api/farm", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try { return reply.send({ items: (await game.snapshot(player.id)).farmItems.filter((item) => item.ownerId === player.id) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/farm/plant", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ contentId: z.string(), x: z.number().optional(), y: z.number().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_plant" });
    try { return reply.code(201).send({ item: await game.plant(player.id, parsed.data) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/farm/adopt", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ contentId: z.string(), x: z.number().optional(), y: z.number().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_animal" });
    try { return reply.code(201).send({ item: await game.adopt(player.id, parsed.data) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.get("/api/farm/structures", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ structures: await persistence.repositories.structures.listByOwnerId(player.id) });
  });

  app.post("/api/farm/structures", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ type: z.enum(["house", "field", "orchard", "animal_pen", "dinosaur_enclosure"]), x: z.number().optional(), y: z.number().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_structure" });
    try { return reply.code(201).send({ structure: await game.buildStructure(player.id, parsed.data) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.get("/api/shop/origin", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ offers: await game.originOffers(player.id) });
  });

  app.post("/api/shop/origin/:offerId/buy", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try { return reply.send(await game.buyOriginOffer(player.id, (request.params as { offerId: string }).offerId)); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/farm/:itemId/care", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try { return reply.send({ item: await game.care(player.id, (request.params as { itemId: string }).itemId) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/farm/:itemId/harvest", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try { return reply.send(await game.harvest(player.id, (request.params as { itemId: string }).itemId)); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/farm/:itemId/collect", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try { return reply.send(await game.collect(player.id, (request.params as { itemId: string }).itemId)); } catch (error) { return sendDomainError(reply, error); }
  });

  app.get("/api/market", async (_request, reply) => reply.send({ listings: (await persistence.repositories.market.listActive()) }));

  app.post("/api/market/listings", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ contentId: z.string(), quantity: z.number(), unitPrice: z.number(), quality: z.enum(["common", "good", "perfect"]).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    try { return reply.code(201).send({ listing: await game.createListing(player.id, parsed.data) }); } catch (error) { return sendDomainError(reply, error); }
  });

  app.post("/api/market/:listingId/buy", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = marketPurchaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_action" });
    const header = request.headers["idempotency-key"];
    const headerKey = Array.isArray(header) ? header[0] : header;
    const idempotencyKey = headerKey ?? parsed.data.idempotencyKey;
    if (!idempotencyKey) return reply.code(400).send({ error: "invalid_action" });
    try { return reply.send(await game.buyListing(player.id, (request.params as { listingId: string }).listingId, idempotencyKey)); } catch (error) { return sendDomainError(reply, error); }
  });

  return app;
}

async function authenticatedPlayer(request: FastifyRequest, auth: AuthService) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return auth.authenticate(token);
}

function sendDomainError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "invalid_credentials" ? 401 : error.code === "nick_taken" ? 409 : 400;
    return reply.code(status).send({ error: error.code, ...(error.code === "invalid_nick" ? { message: "Use de 3 a 20 caracteres, sem espaços. Você pode usar hífen ou underline." } : {}) });
  }
  if (error instanceof GameError) return reply.code(["player_not_found", "farm_item_not_found", "listing_not_found", "region_not_found"].includes(error.code) ? 404 : ["region_reserved", "structure_full", "cannot_buy_own_listing"].includes(error.code) ? 409 : 400).send({ error: error.code });
  return reply.code(500).send({ error: "internal_error" });
}

export { createDefaultAppearance };
