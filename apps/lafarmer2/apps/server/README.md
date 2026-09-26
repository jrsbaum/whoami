# La Farmer 2 — servidor

Fastify + WebSocket em `/ws`. Porta padrão `3338`. Sem `DATABASE_URL` usa memória.

```bash
npm run dev
npm test
```

`GET /healthz` responde `{ status: "ok", service: "lafarmer2-server" }`.
