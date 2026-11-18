"use client";

import { BadgeCheck, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { MarketFetchError } from "@/lib/markets/client";
import type { MarketDetail } from "@/lib/markets/types";
import { getTokenWarnings, type RiskInput, type TokenWarning } from "@/lib/tokens/risk";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/swap/TokenLogo";
import {
  changeClass,
  formatCompactUsd,
  formatCount,
  formatPct,
  formatPrice,
  shortMint,
} from "@/app/trade/terminalFormat";

const MAX_CHIPS = 3;

const CHIP_CLASS: Record<TokenWarning["level"], string> = {
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  info: "border-border/50 bg-muted/40 text-muted-foreground",
};

function riskInput(mint: string, detail: MarketDetail | undefined, fallback?: TokenInfo): RiskInput | null {
  if (detail) {
    const label = detail.organicScoreLabel;
    return {
      mint,
      isVerified: detail.isVerified,
      audit: detail.audit ?? undefined,
      organicScoreLabel: label === "high" || label === "medium" || label === "low" ? label : undefined,
      liquidity: detail.liquidityUsd ?? undefined,
    };
  }
  return fallback && fallback.mint === mint ? fallback : null;
}

/** "Mint authority active: supply can be inflated" -> "Mint authority active". */
function chipText(message: string): string {
  const i = message.indexOf(":");
  return i > 0 ? message.slice(0, i) : message;
}

function Stat({ label, value, title, className }: { label: string; value: React.ReactNode; title?: string; className?: string }) {
  return (
    <div className="shrink-0" title={title}>
      <p className="text-[10px] leading-none text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-[11px] leading-tight", className)}>{value}</p>
    </div>
  );
}

async function copyMint(mint: string) {
  try {
    await navigator.clipboard.writeText(mint);
    toast.success("Mint address copied");
  } catch {
    toast.error("Couldn't copy the mint address");
  }
}

/** Header for the selected market: identity, live stats (Jupiter), safety chips. */
export function MarketBar({ mint, fallback }: { mint: string; fallback?: TokenInfo }) {
  const { data, isPending, isError, error } = useMarketDetail(mint);
  const detail = data && data.mint === mint ? data : undefined;
  const fb = fallback && fallback.mint === mint ? fallback : undefined;

  const symbol = detail?.symbol ?? fb?.symbol ?? shortMint(mint);
  const name = detail?.name ?? fb?.name;
  const icon = detail?.icon ?? fb?.logoURI;
  const verified = detail?.isVerified ?? fb?.isVerified ?? false;
  const delayed = !!detail && (!!detail.stale || isError);
  const notFound = !detail && error instanceof MarketFetchError && error.status === 404;
  const unavailable = !detail && isError && !notFound;

  const warnings = getTokenWarnings(riskInput(mint, detail, fb));
  const chips = warnings.slice(0, MAX_CHIPS);
  const extra = warnings.length - chips.length;

  const priceValue = detail?.priceUsd ?? null;
  const loadingValue = isPending && !detail ? "…" : undefined;

  return (
    <div className="flex h-12 shrink-0 items-center gap-5 overflow-x-auto border-b border-border/50 bg-card/50 px-3">
      <div className="flex shrink-0 items-center gap-2">
        <TokenLogo symbol={symbol} logoURI={icon} className="h-6 w-6" />
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-sm font-bold leading-none">{symbol}</span>
            {verified ? (
              <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-label="Verified by Jupiter" />
            ) : null}
          </div>
          {name && <p className="max-w-36 truncate text-[10px] leading-tight text-muted-foreground">{name}</p>}
        </div>
      </div>

      {notFound ? (
        <p className="shrink-0 text-[11px] text-destructive">Token not found on Jupiter</p>
      ) : (
        <>
          <div className="shrink-0">
            <p className={cn("font-mono text-sm font-semibold leading-tight", changeClass(detail?.change24hPct))}>
              {loadingValue ?? formatPrice(priceValue)}
            </p>
            <p className={cn("font-mono text-[10px] leading-none", changeClass(detail?.change24hPct))}>
              {loadingValue ?? formatPct(detail?.change24hPct)}
              <span className="ml-1 text-muted-foreground">24h</span>
            </p>
          </div>
          <Stat
            label="24h high / low"
            value={
              loadingValue ??
              `${formatPrice(detail?.high24hUsd)} / ${formatPrice(detail?.low24hUsd)}`
            }
            className="text-foreground/90"
            title="From on-chain 1h candles (GeckoTerminal)"
          />
          <Stat label="24h volume" value={loadingValue ?? formatCompactUsd(detail?.volume24hUsd)} title="Jupiter, buy + sell volume" />
          <Stat label="Liquidity" value={loadingValue ?? formatCompactUsd(detail?.liquidityUsd)} title="Jupiter" />
          <Stat label="Mkt cap" value={loadingValue ?? formatCompactUsd(detail?.mcapUsd)} title="Jupiter" />
          <Stat label="Holders" value={loadingValue ?? formatCount(detail?.holderCount)} title="Jupiter" />
          {unavailable && <p className="shrink-0 text-[10px] text-muted-foreground">Market data unavailable</p>}
        </>
      )}

      {chips.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {chips.map((w) => (
            <span
              key={w.message}
              title={w.message}
              className={cn("max-w-40 truncate border px-1 py-px text-[9px] font-medium", CHIP_CLASS[w.level])}
            >
              {chipText(w.message)}
            </span>
          ))}
          {extra > 0 && (
            <span
              title={warnings.slice(MAX_CHIPS).map((w) => w.message).join("\n")}
              className="border border-border/50 px-1 py-px text-[9px] text-muted-foreground"
            >
              +{extra}
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {delayed && (
          <span
            className="border border-yellow-500/40 bg-yellow-500/10 px-1 py-px text-[9px] font-medium uppercase text-yellow-400"
            title="Market data provider is not answering right now; showing the last successful update."
          >
            Delayed
          </span>
        )}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="font-mono" title={mint}>{shortMint(mint)}</span>
          <button
            type="button"
            onClick={() => void copyMint(mint)}
            className="p-0.5 hover:text-foreground"
            aria-label="Copy mint address"
            title="Copy mint address"
          >
            <Copy className="h-3 w-3" />
          </button>
          <a
            href={`https://solscan.io/token/${mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-0.5 hover:text-foreground"
            aria-label="View on Solscan"
            title="View on Solscan"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
