# La Farmer 2

Jogo de fazenda 3D local (Three.js) isolado do LaFarmer 1. Conta, sessão e
estado não se misturam com `apps/lafarmer`.

## Rodar local

```bash
cd apps/lafarmer2
npm install
npm run build
npm run dev:server   # http://127.0.0.1:3338  /healthz
npm run dev:web      # http://127.0.0.1:5176
```

Sem `DATABASE_URL` o servidor usa memória. Reiniciar o processo apaga contas.

## Testes

```bash
npm test
```

Isso cobre catálogo, servidor (incluindo vaca/ração) e o roteamento da próxima
tela. O ciclo longo de crescimento não é encurtado no jogo real.
