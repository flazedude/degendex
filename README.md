# DEGN DEX

A Solana trading front end: best-price swaps through Jupiter's meta-aggregator,
meme and new-pair discovery, a Raydium pool explorer, and TradingView charts.

DEGN DEX does not run its own on-chain exchange program. It routes trades through
existing liquidity (Jupiter, which aggregates Raydium, Orca, Meteora, RFQ market
makers and more), so it inherits their depth and audited contracts.

## Feature status

| Area | Status |
|---|---|
| Swap | Live. Jupiter Swap API v2 (`/order` + `/execute`): all routers compete, Jupiter handles slippage (RTSE), priority fees and transaction landing. Token search by name, symbol or mint, token safety warnings, balances, price-impact guard, deep links (`/swap?inputMint=...&outputMint=...`). |
| Memes | Live, read-only. New pump.fun / Raydium pairs from DexScreener, with a one-click link into Swap. |
| Explore | Live, read-only. Top Solana pairs from DexScreener. |
| Liquidity | Pool explorer is live (Raydium API). Deposits open on Raydium; in-app deposits are on the roadmap. |
| Trade terminal | Charts (TradingView, CEX prices) plus market buy/sell via Swap for verified Solana tokens. On-chain order book and limit orders are on the roadmap. |
| Charts | TradingView embed. |
| Portfolio | Coming soon. |

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev                     # http://localhost:3000
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `JUPITER_API_KEY` | server | Key from [developers.jup.ag/portal](https://developers.jup.ag/portal). See [Rate limits](#rate-limits) for which plan you need. |
| `JUPITER_REFERRAL_ACCOUNT` / `JUPITER_REFERRAL_FEE_BPS` | server | Optional integrator fee (50-255 bps) through the [Jupiter Referral Program](https://referral.jup.ag/). Set both or neither, and create referral token accounts for the fee mints (at least SOL and USDC) or the fee is silently skipped. |
| `NEXT_PUBLIC_HELIUS_RPC_URL` | browser | Solana RPC for wallet balances. Use a provider key restricted to your domains; the public endpoint rate-limits hard. |
| `NEXT_PUBLIC_DEGN_MINT` | browser | Optional DEGN token mint, added to the swap token list. |

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm build` | Production build |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every
pull request.

## Rate limits

All quote and token-search traffic goes through the server routes, so every
visitor shares **one** Jupiter rate limit (it applies per organisation, not per
key). `/swap/v2/execute` has its own, much larger bucket.

| Jupiter plan | Main limit | Good for |
|---|---|---|
| Keyless (no key) | 0.5 req/s | Local development |
| Free key | 1 req/s (60/min) | A few concurrent users |
| Developer and up | 10+ req/s | Real traffic |

An idle swap tab requests a fresh quote about every 20 seconds, plus debounced
requests while typing. On a 429 the app keeps the last quote on screen and retries
once when Jupiter says a slot frees up.

Also add a per-IP rate-limit rule for `/api/jupiter/order` and
`/api/jupiter/tokens` in the Vercel Firewall (for example 30 requests per minute
per IP), so a single client can't use up the shared quota. Leave
`/api/jupiter/execute` out of it: throttling a signed transaction only hurts the
user.

## How a swap works

1. The browser asks `/api/jupiter/order` (our server route) for a quote. The route
   validates and allowlists the parameters, adds the API key and optional referral
   fee, and calls `https://api.jup.ag/swap/v2/order`. When a wallet is connected the
   order includes an unsigned transaction.
2. The user signs that transaction in their wallet. Nothing is sent to an RPC
   directly.
3. The browser posts the signed transaction to `/api/jupiter/execute`, which forwards
   it to Jupiter. Jupiter lands it and returns the result and signature.

The API key never reaches the browser. Amounts are converted with `bignumber.js`,
never floating-point math.

## Project layout

```
src/
  app/            Next.js routes (pages + /api proxies)
  components/     UI by feature (swap, memes, explore, liquidity, trade, ui)
  hooks/          React Query / wallet hooks
  lib/            API clients, Jupiter helpers, amount math, token risk rules
  store/          Zustand stores (swap state, persisted settings)
```

## Roadmap

1. **Swap polish**: referral fee live, recent-swap history, quote countdown.
2. **Real trade terminal**: limit orders and DCA (Jupiter Trigger API), on-chain
   OHLCV charts, drop non-Solana markets; perps (Drift or Jupiter Perps) later.
3. **Liquidity and portfolio**: in-app Raydium deposits/withdrawals (CPMM and CLMM
   ranges) with the Raydium SDK v2; portfolio from wallet token accounts, prices and
   transaction history.
4. **Degen features**: quick-buy presets on Memes, new-pair alerts, safety
   scores, PnL tracking, mobile wallet support.
