// Live sanity check against the real upstreams. Skipped unless LIVE_MARKETS=1:
//   LIVE_MARKETS=1 NODE_USE_ENV_PROXY=1 npx vitest run src/lib/markets/live.test.ts
// Makes 3 GeckoTerminal calls (7s apart) and 2 Jupiter calls (4s apart).
import { describe, expect, it } from "vitest";
import { SOL_MINT } from "@/lib/constants";
import { CURATED_MINTS, getCuratedMarket } from "./curated";
import { getCandles, getTopPool, getTrades } from "./geckoterminal";
import { fetchJupiterPrices, fetchJupiterTokenStats } from "./jupiter";
import { highLow24h, mergeMarkets } from "./service";

const live = process.env.LIVE_MARKETS === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!live)("live upstreams", () => {
  it("parses SOL candles, trades, a runtime pool and the markets merge", async () => {
    const pool = getCuratedMarket(SOL_MINT)!.pool!.address;

    const candles = await getCandles(pool, SOL_MINT, "1h");
    const last = candles[candles.length - 1];
    console.log("candles", candles.length, "first", candles[0], "last", last, "hl24", highLow24h(candles, Date.now()));
    expect(candles.length).toBeGreaterThan(100);
    expect(candles.every((c, i) => i === 0 || c.time > candles[i - 1].time)).toBe(true);
    expect(last.close).toBeGreaterThan(1);

    await sleep(7_000);
    const trades = await getTrades(pool, SOL_MINT);
    console.log("trades", trades.length, trades.slice(0, 2), {
      buys: trades.filter((t) => t.side === "buy").length,
      oldest: new Date(trades[trades.length - 1]?.ts).toISOString(),
    });
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.priceUsd > 1 && t.volumeUsd >= 5)).toBe(true);

    await sleep(7_000);
    const jto = "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL";
    const jtoPool = await getTopPool(jto);
    console.log("JTO runtime pool", jtoPool);

    const prices = await fetchJupiterPrices(CURATED_MINTS);
    await sleep(4_000);
    const stats = await fetchJupiterTokenStats(CURATED_MINTS);
    const markets = mergeMarkets(prices, stats);
    console.log(
      "markets",
      markets.length,
      "priced",
      markets.filter((m) => m.priceUsd !== null).length,
      "with stats",
      markets.filter((m) => m.volume24hUsd !== null).length
    );
    console.table(
      markets.slice(0, 6).map((m) => ({
        symbol: m.symbol,
        price: m.priceUsd,
        chg: m.change24hPct?.toFixed(2),
        vol: m.volume24hUsd?.toExponential(2),
        mcap: m.mcapUsd?.toExponential(2),
      }))
    );
    expect(markets.filter((m) => m.priceUsd !== null).length).toBeGreaterThanOrEqual(CURATED_MINTS.length - 2);
  }, 60_000);
});
