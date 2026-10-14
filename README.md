# DEGN DEX

A Solana trading front end: best-price swaps through Jupiter's meta-aggregator,
a trade terminal with on-chain charts, limit orders and DCA, meme and new-pair
discovery, and a Raydium pool explorer.

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
| Trade terminal | Solana-only markets (curated verified tokens plus search for any token) with live prices, on-chain candles and recent trades (GeckoTerminal), market orders in place (same Jupiter engine as Swap), wallet balances. Limit orders and time-based DCA through the Jupiter Trigger API v2 (beta, see [Limit orders and DCA](#limit-orders-and-dca)). |
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
| `CG_DEMO_API_KEY` | server | Free CoinGecko Demo key ([coingecko.com/en/api](https://www.coingecko.com/en/api)) for terminal candles and trades (100 calls/min). Without it the app uses keyless GeckoTerminal (~10 calls/min per server IP), which is enough for local dev only. |
| `NEXT_PUBLIC_DISABLE_TRIGGER` | server + browser | Kill switch for limit orders and DCA. `1` (or `new`) pauses new orders but keeps Open orders, Cancel and Withdraw working; `all` switches everything off and points users to jup.ag to manage existing orders. The browser reads it at build time, so a change needs a redeploy. |

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

Every Jupiter call goes through the server routes, so all visitors share **one**
Jupiter rate limit (it applies per organisation, not per key). Quotes, token
search, prices and the Trigger API (limit orders, DCA) all draw from it; only
`/swap/v2/execute` has its own, much larger bucket.

| Jupiter plan | Main limit | Good for |
|---|---|---|
| Keyless (no key) | 0.5 req/s | Local development |
| Free key | 1 req/s (60/min) | A handful of concurrent users |
| Developer and up | 10+ req/s | Real traffic, and anything with limit orders on |

Where the budget goes:

- **Swap quotes**: an open swap or market-order form with an amount entered
  requests a fresh quote about every 20 seconds, plus debounced requests while
  typing. On a 429 the app keeps the last quote and retries once when Jupiter
  says a slot frees up, and market data backs off too.
- **Market data** (`/api/markets`, `/api/market/...`): capped at 40 Jupiter
  calls/min with a key, 10 keyless. Baseline is about 7 calls/min for the curated
  market list. Prices and stats are cached per token and shared by everyone, so
  each additional token that someone is viewing or holding adds a few calls a
  minute, not one per visitor. When an upstream is rate-limited the routes serve
  the last good data (up to 10 minutes) and the UI marks it as delayed.
- **Limit orders and DCA**: each signed-in user polls their order list about
  every 30 seconds while the tab is visible. This one grows with users.
- Budgets and caches are per server instance (per serverless instance or region
  on Vercel), so several instances together can spend more.

Candles and recent trades come from GeckoTerminal: about 10 calls/min per server
IP without a key, 100/min with `CG_DEMO_API_KEY`.

Also add per-IP rate-limit rules in the Vercel Firewall so a single client can't
use up the shared quotas, for example 30 requests per minute per IP on
`/api/jupiter/order`, `/api/jupiter/tokens` and `/api/market/*`, and on `GET`
requests to `/api/jupiter/trigger/*` (order history and vault). Leave
`/api/jupiter/execute` and the Trigger calls that carry a signed transaction
(`POST` to `deposit/craft`, `orders/*`, `cancel` and `confirm-cancel`) out of it:
throttling those only hurts the user mid-order.

## Limit orders and DCA

Limit orders and DCA use the Jupiter Trigger API v2, the same system as
jup.ag's own limit orders. It is **custodial**: when a user places an order,
the tokens for it move from their wallet into a Jupiter vault (custody by Privy)
until the order fills or is cancelled, and withdrawing needs Jupiter's service.
Users see a one-time consent screen that says this before their first order.

- Signing in to the Trigger API is one wallet signature (a message, or a memo
  transaction that can never land, for Ledger). The access token lives in memory
  for 15 minutes; the refresh token lives in `sessionStorage` and dies with the
  tab.
- Every transaction (sign-in, deposit, withdrawal) is decoded and checked in the
  browser before the wallet is asked to sign it.
- Minimum $10 per order (per round for DCA). Expired orders do not refund
  automatically: they show a Withdraw button under Open orders.
- DEGN DEX takes no fee on these orders (the Trigger API has no integrator fee).
  Jupiter charges its own fee when an order fills (about 0.03-0.1% plus up to
  0.5% routing, per Jupiter's docs).
- The API is in beta. Do one end-to-end test with a small amount before relying
  on it. If something breaks, set `NEXT_PUBLIC_DISABLE_TRIGGER=1` and redeploy:
  new orders pause, but users can still see, cancel and withdraw what they have.
- Sign-in, token refresh, vault registration, order history and deposit crafting
  were tested live through the proxy with a throwaway wallet, and the deposit
  safety check is tested against real Jupiter deposit transactions
  (`src/lib/jupiter/trigger/__fixtures__`). Placing, filling and cancelling an
  order with real funds is the part still to test.

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
2. **Trade terminal, next steps**: take-profit/stop-loss (OCO) orders,
   price-conditional DCA, streaming trades; perps (Drift or Jupiter Perps) later.
3. **Liquidity and portfolio**: in-app Raydium deposits/withdrawals (CPMM and CLMM
   ranges) with the Raydium SDK v2; portfolio from wallet token accounts, prices and
   transaction history.
4. **Degen features**: quick-buy presets on Memes, new-pair alerts, safety
   scores, PnL tracking, mobile wallet support.
