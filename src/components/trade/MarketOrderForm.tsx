"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { useSwap, type SwapSource } from "@/hooks/useSwap";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatTokenAmount, formatUsd, sanitizeAmount } from "@/lib/amounts";
import { formatPriceImpact } from "@/lib/jupiter/priceImpact";
import { getTokenWarnings } from "@/lib/tokens/risk";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { SwapSettings } from "@/components/swap/SwapSettings";
import { TokenLogo } from "@/components/swap/TokenLogo";
import { TokenWarningBanner } from "@/components/swap/TokenWarningBanner";
import { swapButtonState, swappingLabelFor } from "@/components/swap/swapButtonState";
import { useArmedConfirm } from "@/components/swap/useArmedConfirm";
import {
  SEVERITY_CLASS,
  exceedsBalance,
  formatRate,
  getSpendableRaw,
  portionAmount,
  routeText,
  slippageDisplay,
} from "@/components/swap/swapDetails";
import {
  marketOrderTokens,
  swapPageHref,
  type MarketSide,
} from "@/components/swap/marketPair";

const PORTIONS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "75%", f: 0.75 },
  { label: "100%", f: 1 },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-foreground/90">{children}</span>
    </div>
  );
}

/**
 * Market buy / sell of `base` against USDC (SOL when the base is USDC), on the
 * same swap engine as the Swap page but with its own local pair and amount.
 */
export function MarketOrderForm({ base }: { base: TokenInfo }) {
  const [side, setSide] = useState<MarketSide>("buy");
  const [amount, setAmount] = useState("");
  // A new market starts with an empty amount (React's "adjust state when a
  // prop changes" pattern: no effect, no flash of the old amount).
  const [amountMint, setAmountMint] = useState(base.mint);
  if (amountMint !== base.mint) {
    setAmountMint(base.mint);
    setAmount("");
  }

  const { input, output } = useMemo(() => marketOrderTokens(base, side), [base, side]);
  const source = useMemo<SwapSource>(
    () => ({ inputToken: input, outputToken: output, inputAmount: amount, setInputAmount: setAmount }),
    [input, output, amount]
  );
  const swap = useSwap(source);
  const { order, rawAmount, outAmount, minReceived, priceImpactPct, severity } = swap;
  const slippage = useSettingsStore((s) => s.slippage);
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const payBal = useTokenBalance(input);
  const confirm = useArmedConfirm();

  // Also busy while a swap from this wallet started before a remount / market
  // change is still running.
  const busy = swap.swapping || !!swap.swapInFlight;
  const verb = side === "buy" ? "Buy" : "Sell";

  const spendableRaw = useMemo(
    () => getSpendableRaw(payBal.raw, input.mint),
    [payBal.raw, input.mint]
  );
  const insufficient = connected && exceedsBalance(rawAmount, payBal.raw);

  const setPortion = (fraction: number) => {
    if (!spendableRaw) return;
    setAmount(portionAmount(spendableRaw, fraction, input.decimals));
  };

  const changeSide = (next: MarketSide) => {
    if (next === side) return;
    setSide(next);
    // The amount is denominated in what you pay, which flips with the side.
    setAmount("");
  };

  // "1 BASE = x QUOTE" on both sides.
  const price = useMemo(
    () => formatRate(order, outAmount, input, output, side === "buy"),
    [order, outAmount, input, output, side]
  );
  const warnings = useMemo(
    () => getTokenWarnings(base).filter((w) => w.level !== "info"),
    [base]
  );

  const armed = !!order && confirm.armedId === order.requestId;
  const impactLabel = formatPriceImpact(priceImpactPct);
  const button = swapButtonState({
    connected,
    swapping: busy,
    pendingSwap: swap.pendingSwap,
    rawAmount,
    insufficient,
    inputSymbol: input.symbol,
    isQuoting: swap.isQuoting,
    quoteError: swap.quoteError,
    orderError: swap.orderError,
    order,
    severity,
    priceImpactPct,
    armed,
    actionLabel: `${verb} ${base.symbol}`,
    swappingLabel: swappingLabelFor(
      swap.swapInFlight,
      { inputMint: input.mint, outputMint: output.mint },
      side === "buy" ? "Buying..." : "Selling..."
    ),
    compact: true,
  });

  const handleButtonClick = () => {
    if (button.action === "connect") {
      setVisible(true);
    } else if (button.action === "swap") {
      void swap.executeSwap();
    } else if (button.action === "confirm-extreme" && order) {
      if (confirm.press(order.requestId)) {
        void swap.executeSwap({ acceptedImpactPct: priceImpactPct });
      }
    }
  };

  const inUsd = formatUsd(order?.inUsdValue);
  const outUsd = formatUsd(order?.outUsdValue);
  const showDetails = !!order && !swap.quoteError;
  const { slippageText, minReceivedUnknown } = slippageDisplay(order, slippage);
  const balanceText =
    payBal.ui !== undefined ? formatTokenAmount(payBal.ui) : payBal.isLoading ? "…" : "—";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <div className="grid flex-1 grid-cols-2 gap-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              disabled={busy}
              onClick={() => changeSide(s)}
              className={cn(
                "border py-1 text-[11px] font-bold uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                side === s
                  ? s === "buy"
                    ? "border-primary/50 bg-primary/20 text-primary"
                    : "border-destructive/50 bg-destructive/20 text-destructive"
                  : "border-transparent bg-muted/30 text-muted-foreground enabled:hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={swap.refresh}
          disabled={!rawAmount || busy}
          aria-label="Refresh quote"
          className="h-6 w-6 rounded-none text-muted-foreground hover:text-foreground"
        >
          <RefreshCw
            className={cn("h-3 w-3", (swap.isRefreshing || swap.isQuoting) && rawAmount && "animate-spin")}
          />
        </Button>
        <SwapSettings triggerClassName="h-6 gap-1 rounded-none px-1 text-[10px] [&_svg]:h-3.5 [&_svg]:w-3.5" />
      </div>

      {/* Pay */}
      <div className="border border-border/50 bg-background/50 px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wide">You pay</span>
          {connected && (
            <span className="font-mono" title={payBal.ui}>
              Bal: {balanceText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            aria-label={`Amount of ${input.symbol} to pay`}
            value={amount}
            disabled={busy}
            onChange={(e) => {
              const next = sanitizeAmount(e.target.value, input.decimals);
              if (next !== null) setAmount(next);
            }}
            className="min-w-0 flex-1 bg-transparent py-0.5 font-mono text-base font-semibold outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
          />
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold">
            <TokenLogo symbol={input.symbol} logoURI={input.logoURI} className="h-4 w-4 text-[9px]" />
            <span className="max-w-[5.5rem] truncate">{input.symbol}</span>
          </span>
        </div>
        <div className="h-3.5 font-mono text-[10px] leading-3.5 text-muted-foreground">
          {inUsd ? `≈ ${inUsd}` : ""}
        </div>
      </div>

      {connected && (
        <div className="grid grid-cols-4 gap-1">
          {PORTIONS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={busy || !spendableRaw}
              onClick={() => setPortion(p.f)}
              className="border border-border/50 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors enabled:hover:border-primary/60 enabled:hover:text-primary disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Receive */}
      <div className="border border-border/50 bg-background/30 px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wide">You receive (est.)</span>
          <span className="font-mono">{outUsd ? `≈ ${outUsd}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            aria-live="polite"
            title={outAmount || undefined}
            className={cn(
              "min-w-0 flex-1 truncate py-0.5 font-mono text-base font-semibold",
              (!outAmount || swap.isStale) && "text-muted-foreground/50"
            )}
          >
            {swap.isQuoting && rawAmount ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : outAmount ? (
              formatTokenAmount(outAmount, { significant: 6, maxDecimals: 6 })
            ) : (
              "0.00"
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold">
            <TokenLogo symbol={output.symbol} logoURI={output.logoURI} className="h-4 w-4 text-[9px]" />
            <span className="max-w-[5.5rem] truncate">{output.symbol}</span>
          </span>
        </div>
      </div>

      {showDetails && order && (
        <div className="space-y-0.5 border border-border/40 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground">
          {price && <Row label="Avg price">{price}</Row>}
          <Row label="Price impact">
            <span className={SEVERITY_CLASS[severity]}>{impactLabel}</span>
          </Row>
          <Row label="Min received">
            {minReceivedUnknown
              ? "Connect wallet to see"
              : `${formatTokenAmount(minReceived, { significant: 6, maxDecimals: 6 })} ${output.symbol}`}
          </Row>
          <Row label="Slippage">{slippageText}</Row>
          {swap.feeBps !== null && (
            <Row label="Fee">
              {swap.feeBps / 100}%{order.gasless ? " · gasless" : ""}
            </Row>
          )}
          <Row label="Route">
            <span title={routeText(swap.router, swap.routeLabels)}>
              {routeText(swap.router, swap.routeLabels)}
            </span>
          </Row>
          {severity === "high" && (
            <p className="pt-0.5 text-orange-500">
              High price impact ({impactLabel}): you get noticeably less than the market rate.
            </p>
          )}
          {swap.isStale && <p className="pt-0.5 text-yellow-500">Quote may be outdated, refreshing…</p>}
        </div>
      )}

      <TokenWarningBanner token={base} warnings={warnings} compact />

      <Button
        onClick={handleButtonClick}
        disabled={button.action === null}
        className={cn(
          "h-9 w-full rounded-none text-xs font-bold uppercase tracking-wide",
          button.tone === "primary" &&
            (side === "buy"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90"),
          button.tone === "connect" && "bg-secondary text-secondary-foreground hover:bg-secondary/90",
          button.tone === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          button.tone === "muted" && "bg-muted text-muted-foreground"
        )}
      >
        {button.spin && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span className="truncate">{button.label}</span>
      </Button>

      {connected && swap.pendingSwap?.canDismiss && (
        <p className="text-center text-[10px] text-muted-foreground">
          Your last swap&apos;s status could not be confirmed.{" "}
          <button
            type="button"
            onClick={swap.dismissPending}
            className="underline underline-offset-2 hover:text-primary"
          >
            I&apos;ve checked my wallet
          </button>
        </p>
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Routed by Jupiter</span>
        <Link
          href={swapPageHref(input.mint, output.mint)}
          className="inline-flex items-center gap-0.5 hover:text-primary"
        >
          Open in Swap <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
