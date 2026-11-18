// Pure candle helpers for the terminal price chart (no lightweight-charts
// import, so they run in vitest's node environment).
import type { Candle, Timeframe } from "@/lib/markets/types";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1d": 86_400,
};

/** A live tick further than this from the last close is treated as bad data. */
const MAX_LIVE_DEVIATION = 0.25;

function isFiniteCandle(c: Candle): boolean {
  return (
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    c.open > 0 &&
    c.high > 0 &&
    c.low > 0 &&
    c.close > 0
  );
}

/** Ascending by time, one candle per time (the last one wins), finite only. */
export function prepareCandles(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (!c || !isFiniteCandle(c)) continue;
    byTime.set(Math.floor(c.time), {
      ...c,
      time: Math.floor(c.time),
      volume: Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/**
 * The open candle nudged by a live price tick, or null when the tick must not
 * be drawn. Only the current bucket is touched: either the last candle (when
 * it is the current bucket) or a new bucket directly after it (opened at the
 * last close). `current` is the previously nudged candle, so highs and lows
 * from earlier ticks in the same bucket are kept until the next candle poll.
 */
export function liveCandle(
  last: Candle | undefined,
  current: Candle | null,
  price: number | null | undefined,
  tf: Timeframe,
  nowSec: number
): Candle | null {
  if (!last || typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  if (!(last.close > 0) || Math.abs(price / last.close - 1) > MAX_LIVE_DEVIATION) return null;
  const step = TIMEFRAME_SECONDS[tf];
  const bucket = Math.floor(nowSec / step) * step;

  let start: Candle;
  if (current && current.time === bucket && bucket >= last.time) {
    start = current;
  } else if (bucket === last.time) {
    start = last;
  } else if (bucket === last.time + step) {
    start = { time: bucket, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 };
  } else {
    // Clock skew or a provider whose buckets are aligned differently: skip.
    return null;
  }
  return {
    ...start,
    close: price,
    high: Math.max(start.high, price),
    low: Math.min(start.low, price),
  };
}

/** Chart price format from magnitude, so 0.00001234 still shows 4 significant digits. */
export function chartPriceFormat(price: number | null | undefined): {
  type: "price";
  precision: number;
  minMove: number;
} {
  let precision = 2;
  if (typeof price === "number" && Number.isFinite(price) && price > 0) {
    if (price >= 100) precision = 2;
    else if (price >= 1) precision = 4;
    else precision = Math.min(12, Math.ceil(-Math.log10(price)) + 3);
  }
  return { type: "price", precision, minMove: Number(`1e-${precision}`) };
}
