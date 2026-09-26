# La Farmer 2

Workspace npm isolado em `apps/lafarmer2`. Não compartilha identidade, sessão
nem banco com `apps/lafarmer`. Cliente Three.js; o servidor é autoritativo.

## Fontes

- `packages/content`: catálogos, mundo 80×60 e ofertas da Loja do Vale.
- `apps/server`: Fastify + WebSocket, store em memória sem `DATABASE_URL`.
- `apps/web`: HUD HTML/Tailwind + cena Three.js.

Portas locais: servidor `3338`, Vite `5176`. Health: `GET /healthz`.

Não ligue este workspace aos scripts npm da raiz nem ao lobby.

## Comandos

A partir de `apps/lafarmer2`:

- `npm ci` ou `npm install`
- `npm run build`
- `npm test`
- `npm run dev:server`
- `npm run dev:web`
