// Shared market-data contracts between the /api/market* routes and the client
// hooks. Keep these names stable: UI code builds against them.

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface MarketSummary {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  isVerified: boolean;
  tier: "core" | "ecosystem" | "search";
  priceUsd: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  mcapUsd: number | null;
}

export interface MarketsResponse {
  markets: MarketSummary[];
  updatedAt: number;
  stale?: boolean;
}

export interface MarketDetail extends MarketSummary {
  holderCount: number | null;
  organicScoreLabel: string | null;
  tags: string[];
  tokenProgram: string | null;
  audit: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
  } | null;
  high24hUsd: number | null;
  low24hUsd: number | null;
  pool: { address: string; dex: string; quoteSymbol: string } | null;
  updatedAt: number;
  stale?: boolean;
}

export interface Candle {
  /** Unix seconds, bucket start. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlesResponse {
  mint: string;
  tf: Timeframe;
  pool: { address: string; dex: string } | null;
  candles: Candle[];
  updatedAt: number;
  stale?: boolean;
}

export interface MarketTrade {
  id: string;
  /** Unix ms. */
  ts: number;
  side: "buy" | "sell";
  priceUsd: number;
  /** Token units, display only. */
  amount: number;
  volumeUsd: number;
  txHash: string;
  wallet?: string;
}

export interface TradesResponse {
  mint: string;
  pool: { address: string; dex: string } | null;
  trades: MarketTrade[];
  updatedAt: number;
  stale?: boolean;
}

export interface WalletHolding {
  mint: string;
  /** Base units. */
  raw: string;
  decimals: number;
}

export const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}
