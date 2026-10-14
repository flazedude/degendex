"use client";

// Client-only: load with next/dynamic({ ssr: false }).
//
// TradingView Lightweight Charts™
// Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
// (Apache-2.0 attribution notice; the on-chart attributionLogo stays on to
// satisfy the licence's link requirement.)

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2, RefreshCw } from "lucide-react";
import { useCandles } from "@/hooks/useCandles";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { MarketFetchError } from "@/lib/markets/client";
import { TIMEFRAMES, isTimeframe, type Candle, type Timeframe } from "@/lib/markets/types";
import { cn } from "@/lib/utils";
import { chartPriceFormat, liveCandle, prepareCandles } from "@/app/trade/chartData";
import { formatCompactUsd, formatPlainPrice } from "@/app/trade/terminalFormat";

const TF_STORAGE_KEY = "degn:trade:tf";
/** Bars shown when a market or timeframe first loads (the rest is a scroll away). */
const INITIAL_BARS = 150;

interface Palette {
  up: string;
  down: string;
  upVol: string;
  downVol: string;
  bg: string;
  text: string;
  grid: string;
  border: string;
  font: string;
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** App colours from globals.css, with the same values as fallbacks. */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const up = v("--primary", "#00ff88");
  const down = v("--destructive", "#ff3366");
  const border = v("--border", "#27273a");
  return {
    up,
    down,
    upVol: withAlpha(up, 0.35),
    downVol: withAlpha(down, 0.35),
    bg: v("--background", "#0a0a0f"),
    text: v("--muted-foreground", "#71717a"),
    grid: withAlpha(border, 0.45),
    border,
    font: v("--font-geist-mono", "ui-monospace, monospace"),
  };
}

function readStoredTimeframe(): Timeframe {
  try {
    const v = window.localStorage.getItem(TF_STORAGE_KEY);
    if (isTimeframe(v)) return v;
  } catch {
    // storage blocked: use the default
  }
  return "15m";
}

function storeTimeframe(tf: Timeframe) {
  try {
    window.localStorage.setItem(TF_STORAGE_KEY, tf);
  } catch {
    // ignore
  }
}

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});

function poolLabel(dex: string): string {
  return dex
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

interface Legend {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * On-chain USD candles (GeckoTerminal, top pool) with a volume histogram, plus
 * the live Jupiter price nudging the open candle between 60s candle polls.
 */
export function PriceChart({ mint }: { mint: string }) {
  const [tf, setTf] = useState<Timeframe>(readStoredTimeframe);
  const candlesQuery = useCandles(mint, tf);
  const detailQuery = useMarketDetail(mint);
  const { data, isPending, isError, error, isFetching, refetch } = candlesQuery;

  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const shownKeyRef = useRef<string | null>(null);
  const liveRef = useRef<Candle | null>(null);
  const [hover, setHover] = useState<Legend | null>(null);

  const candles = useMemo(() => (data ? prepareCandles(data.candles) : []), [data]);
  const dataKey = `${mint}:${tf}`;
  // A failed refresh keeps the last candles on screen; they are then delayed.
  const delayed = !!data && (!!data.stale || isError);
  const noPool = !!data && data.pool === null;

  // Create the chart once; autoSize follows the container.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const p = readPalette();
    paletteRef.current = p;
    const chart = createChart(box, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontSize: 10,
        fontFamily: p.font,
        attributionLogo: true,
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: p.up,
      downColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      borderVisible: false,
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(candle) as CandlestickData<UTCTimestamp> | undefined;
      if (!bar || param.time === undefined || !("open" in bar)) {
        setHover(null);
        return;
      }
      const vol = param.seriesData.get(volume) as HistogramData<UTCTimestamp> | undefined;
      setHover({
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol && "value" in vol ? vol.value : null,
      });
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      shownKeyRef.current = null;
      liveRef.current = null;
    };
  }, []);

  // Full resync on every candle poll (also drops any live nudge). A new market
  // or timeframe has no data yet, which clears the old series instead of
  // leaving it under the loading overlay.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const p = paletteRef.current;
    if (!chart || !candle || !volume || !p) return;
    liveRef.current = null;
    if (candles.length === 0) {
      candle.setData([]);
      volume.setData([]);
      shownKeyRef.current = null;
      return;
    }
    candle.applyOptions({ priceFormat: chartPriceFormat(candles[candles.length - 1].close) });
    candle.setData(candles.map(toBar));
    volume.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? p.upVol : p.downVol,
      }))
    );
    if (shownKeyRef.current !== dataKey) {
      shownKeyRef.current = dataKey;
      const n = candles.length;
      if (n > INITIAL_BARS) {
        chart.timeScale().setVisibleLogicalRange({ from: n - INITIAL_BARS, to: n + 3 });
      } else {
        chart.timeScale().fitContent();
      }
    }
  }, [candles, dataKey]);

  // Live tick: nudge the current bucket only. Skipped while either feed is
  // delayed, so a stale chart is never dressed up with a live price.
  const detail = detailQuery.data;
  const livePrice =
    detail && detail.mint === mint && !detail.stale && !detailQuery.isError ? detail.priceUsd : null;
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || delayed || candles.length === 0 || shownKeyRef.current !== dataKey) return;
    const next = liveCandle(
      candles[candles.length - 1],
      liveRef.current,
      livePrice,
      tf,
      Math.floor(Date.now() / 1000)
    );
    if (!next) return;
    try {
      candle.update(toBar(next));
      liveRef.current = next;
    } catch {
      // update() rejects bars older than the last one; the next poll resyncs.
    }
  }, [livePrice, candles, delayed, tf, dataKey]);

  const changeTf = (next: Timeframe) => {
    if (next === tf) return;
    setTf(next);
    setHover(null);
    storeTimeframe(next);
  };

  const last = candles[candles.length - 1];
  const legend: Legend | null =
    hover ?? (last ? { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume } : null);
  const legendUp = legend ? legend.close >= legend.open : true;

  let overlay: React.ReactNode = null;
  if (isPending) {
    overlay = (
      <span className="flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading chart…
      </span>
    );
  } else if (!data && isError) {
    const limited = error instanceof MarketFetchError && (error.status === 503 || error.status === 429);
    overlay = (
      <span className="flex flex-col items-center gap-1.5">
        <span>{limited ? "Chart data is temporarily rate limited" : "Couldn't load chart data"}</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="pointer-events-auto flex items-center gap-1 border border-border/50 px-2 py-0.5 text-[10px] text-foreground hover:bg-muted/50"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} /> Retry
        </button>
      </span>
    );
  } else if (noPool) {
    overlay = <span>No on-chain pool found for this token</span>;
  } else if (data && candles.length === 0) {
    overlay = <span>No candles for this timeframe yet</span>;
  }

  const pool = data?.pool ?? null;
  const gtHref = pool
    ? `https://www.geckoterminal.com/solana/pools/${pool.address}`
    : "https://www.geckoterminal.com/solana/pools";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 px-2 py-1">
        <div role="group" aria-label="Timeframe" className="flex items-center gap-0.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => changeTf(t)}
              aria-pressed={t === tf}
              className={cn(
                "px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                t === tf ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {legend && (
          <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
            {(["open", "high", "low", "close"] as const).map((k) => (
              <span key={k} className="whitespace-nowrap">
                {k[0].toUpperCase()}{" "}
                <span className={legendUp ? "text-primary" : "text-destructive"}>
                  {formatPlainPrice(legend[k])}
                </span>
              </span>
            ))}
            {legend.volume !== null && (
              <span className="hidden whitespace-nowrap sm:inline">
                V <span className="text-foreground/80">{formatCompactUsd(legend.volume)}</span>
              </span>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isFetching && !isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Refreshing" />}
          {delayed && (
            <span
              className="border border-yellow-500/40 bg-yellow-500/10 px-1 py-px text-[9px] font-medium uppercase text-yellow-400"
              title="The chart provider is not answering right now; these candles are from the last successful update."
            >
              Delayed
            </span>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={boxRef} className="absolute inset-0" />
        {overlay && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-[11px] text-muted-foreground">
            {overlay}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">
        <span>
          On-chain price
          {pool ? <> · {poolLabel(pool.dex)} pool</> : null} · data{" "}
          <a href={gtHref} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
            GeckoTerminal
          </a>
        </span>
        <span className="text-muted-foreground/60">· times UTC</span>
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-muted-foreground/60 hover:text-foreground"
          title="TradingView Lightweight Charts™ Copyright (c) 2025 TradingView, Inc."
        >
          Lightweight Charts™ by TradingView
        </a>
      </div>
    </div>
  );
}

export default PriceChart;
