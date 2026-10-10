"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BigNumber from "bignumber.js";
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { useSwapStore, type TokenInfo } from "@/store/useSwapStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSwap } from "@/hooks/useSwap";
import { useTokenBalance, type TokenBalance } from "@/hooks/useTokenBalance";
import { SOL_MINT } from "@/lib/constants";
import {
  formatTokenAmount,
  formatUsd,
  fromBaseUnits,
  safeBigNumber,
  sanitizeAmount,
} from "@/lib/amounts";
import { formatPriceImpact, type ImpactSeverity } from "@/lib/jupiter/priceImpact";
import { getTokenWarnings, type TokenWarning } from "@/lib/tokens/risk";
import { cn, shortenAddress } from "@/lib/utils";
import { TokenSelector } from "./TokenSelector";
import { SwapSettings, slippageLabel } from "./SwapSettings";
import { TokenLogo } from "./TokenLogo";

/** Kept back on MAX for SOL: network fees, ATA rent, wrapping. */
const SOL_FEE_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL
const CONFIRM_WINDOW_MS = 5_000;
/** Clicks this soon after arming (e.g. a double-click) do not confirm. */
const CONFIRM_MIN_DELAY_MS = 600;

const ROUTER_NAMES: Record<string, string> = {
  metis: "Metis",
  jupiterz: "JupiterZ RFQ",
  dflow: "DFlow",
  okx: "OKX",
};

const SEVERITY_CLASS: Record<ImpactSeverity, string> = {
  low: "text-primary",
  medium: "text-yellow-500",
  high: "text-orange-500",
  extreme: "text-destructive font-semibold",
};

function BalanceLabel({ balance, connected }: { balance: TokenBalance; connected: boolean }) {
  if (!connected) return null;
  const text =
    balance.ui !== undefined
      ? formatTokenAmount(balance.ui)
      : balance.isLoading
        ? "…"
        : "—";
  return (
    <span className="font-mono text-xs text-muted-foreground" title={balance.ui}>
      Balance: {text}
    </span>
  );
}

function TokenButton({
  token,
  onSelect,
  disabled,
}: {
  token: TokenInfo;
  onSelect: (t: TokenInfo) => void;
  disabled: boolean;
}) {
  return (
    <TokenSelector selectedToken={token} onSelect={onSelect} disabled={disabled}>
      <Button
        variant="outline"
        className="h-9 shrink-0 gap-2 border-border bg-muted/50 px-2 font-semibold hover:bg-muted"
      >
        <TokenLogo symbol={token.symbol} logoURI={token.logoURI} />
        <span className="max-w-[7rem] truncate">{token.symbol}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    </TokenSelector>
  );
}

function WarningBanner({ token, warnings }: { token: TokenInfo; warnings: TokenWarning[] }) {
  if (warnings.length === 0) return null;
  const danger = warnings.some((w) => w.level === "danger");
  return (
    <div
      role="alert"
      className={cn(
        "border px-3 py-2 text-xs",
        danger
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-yellow-500/40 bg-yellow-500/10 text-yellow-500"
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5" />
          {token.symbol}
          <span className="font-mono font-normal opacity-80">{shortenAddress(token.mint)}</span>
        </span>
        <a
          href={`https://solscan.io/token/${token.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Solscan <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <ul className="space-y-0.5">
        {warnings.map((w) => (
          <li key={w.message}>• {w.message}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 text-right font-mono text-foreground/90">{children}</span>
    </div>
  );
}

export function SwapCard() {
  const inputToken = useSwapStore((s) => s.inputToken);
  const outputToken = useSwapStore((s) => s.outputToken);
  const inputAmount = useSwapStore((s) => s.inputAmount);
  const setInputToken = useSwapStore((s) => s.setInputToken);
  const setOutputToken = useSwapStore((s) => s.setOutputToken);
  const setInputAmount = useSwapStore((s) => s.setInputAmount);
  const switchTokens = useSwapStore((s) => s.switchTokens);
  const slippage = useSettingsStore((s) => s.slippage);

  const swap = useSwap();
  const { order, rawAmount, outAmount, minReceived, priceImpactPct, severity } = swap;
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const inBal = useTokenBalance(inputToken);
  const outBal = useTokenBalance(outputToken);

  const [invertRate, setInvertRate] = useState(false);
  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedAt = useRef(0);

  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  const busy = swap.swapping;

  const spendableRaw = useMemo(() => {
    if (inBal.raw === undefined) return null;
    let b = safeBigNumber(inBal.raw);
    if (inputToken.mint === SOL_MINT) b = b.minus(SOL_FEE_RESERVE_LAMPORTS);
    return BigNumber.max(b, 0);
  }, [inBal.raw, inputToken.mint]);

  const insufficient =
    connected &&
    !!rawAmount &&
    inBal.raw !== undefined &&
    safeBigNumber(rawAmount).gt(safeBigNumber(inBal.raw));

  const setPortion = (fraction: number) => {
    if (!spendableRaw) return;
    const raw = spendableRaw.times(fraction).integerValue(BigNumber.ROUND_DOWN);
    setInputAmount(raw.gt(0) ? fromBaseUnits(raw.toFixed(0), inputToken.decimals) : "");
  };

  const rate = useMemo(() => {
    if (!order) return null;
    const inUi = safeBigNumber(fromBaseUnits(order.inAmount, inputToken.decimals));
    const outUi = safeBigNumber(outAmount);
    if (!inUi.gt(0) || !outUi.gt(0)) return null;
    return invertRate
      ? `1 ${outputToken.symbol} = ${formatTokenAmount(inUi.div(outUi).toFixed())} ${inputToken.symbol}`
      : `1 ${inputToken.symbol} = ${formatTokenAmount(outUi.div(inUi).toFixed())} ${outputToken.symbol}`;
  }, [order, outAmount, invertRate, inputToken, outputToken]);

  const outWarnings = useMemo(
    () => getTokenWarnings(outputToken).filter((w) => w.level !== "info"),
    [outputToken]
  );
  const inWarnings = useMemo(
    () => getTokenWarnings(inputToken).filter((w) => w.level === "danger"),
    [inputToken]
  );

  const armed = !!order && armedId === order.requestId;
  const impactLabel = formatPriceImpact(priceImpactPct);

  type ButtonAction = "connect" | "swap" | "confirm-extreme" | null;
  let button: {
    label: string;
    tone: "primary" | "connect" | "danger" | "muted";
    action: ButtonAction;
    spin?: boolean;
  };
  if (!connected) {
    button = { label: "Connect Wallet", tone: "connect", action: "connect" };
  } else if (busy) {
    button = { label: "Swapping...", tone: "primary", action: null, spin: true };
  } else if (swap.pendingSwap) {
    button = {
      label: "Previous swap may still land - check wallet",
      tone: "muted",
      action: null,
      spin: !swap.pendingSwap.canDismiss,
    };
  } else if (!rawAmount) {
    button = { label: "Enter an amount", tone: "muted", action: null };
  } else if (insufficient) {
    button = { label: `Insufficient ${inputToken.symbol} balance`, tone: "muted", action: null };
  } else if (swap.isQuoting) {
    button = { label: "Fetching quote...", tone: "muted", action: null, spin: true };
  } else if (swap.quoteError) {
    button = { label: swap.quoteError, tone: "muted", action: null };
  } else if (swap.orderError) {
    button = { label: swap.orderError, tone: "muted", action: null };
  } else if (!order) {
    button = { label: "No route found", tone: "muted", action: null };
  } else if (!order.transaction) {
    // Taker was sent but Jupiter returned no transaction and no error code.
    button = { label: "Quote unavailable, retrying", tone: "muted", action: null };
  } else if (severity === "extreme") {
    button = {
      label: armed
        ? `Click again to confirm (impact ${impactLabel})`
        : `Swap anyway (price impact ${impactLabel})`,
      tone: "danger",
      action: "confirm-extreme",
    };
  } else if (severity === "high") {
    button = { label: `Swap (price impact ${impactLabel})`, tone: "primary", action: "swap" };
  } else {
    button = { label: "Swap", tone: "primary", action: "swap" };
  }

  const handleButtonClick = () => {
    if (button.action === "connect") {
      setVisible(true);
    } else if (button.action === "swap") {
      void swap.executeSwap();
    } else if (button.action === "confirm-extreme" && order) {
      if (!armed) {
        if (armTimer.current) clearTimeout(armTimer.current);
        setArmedId(order.requestId);
        armedAt.current = Date.now();
        armTimer.current = setTimeout(() => setArmedId(null), CONFIRM_WINDOW_MS);
        return;
      }
      // A double-click or a too-quick second click must not confirm. Timing
      // only: MouseEvent.detail keeps counting for users with a slow OS
      // double-click setting, which would make confirming impossible.
      if (Date.now() - armedAt.current < CONFIRM_MIN_DELAY_MS) return;
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmedId(null);
      void swap.executeSwap({ acceptedImpactPct: priceImpactPct });
    }
  };

  const inUsd = formatUsd(order?.inUsdValue);
  const outUsd = formatUsd(order?.outUsdValue);
  const showDetails = !!order && !swap.quoteError;

  // Without a taker (no wallet) Jupiter does not set Auto slippage, so the
  // threshold equals the quote: do not present that as a minimum. RFQ
  // (JupiterZ) fills at the quoted price, so there the minimum is the quote.
  const isRfq = order?.router === "jupiterz";
  const noTaker = order?.transaction === null;
  const orderSlippageBps =
    typeof order?.slippageBps === "number" && Number.isFinite(order.slippageBps)
      ? order.slippageBps
      : null;
  let slippageText: string;
  if (isRfq) {
    slippageText = "Fixed price (RFQ)";
  } else if (noTaker) {
    slippageText = slippage === "auto" ? "Auto (set when you connect)" : slippageLabel(slippage);
  } else if (orderSlippageBps === null) {
    slippageText = slippageLabel(slippage);
  } else {
    const pct = `${orderSlippageBps / 100}%`;
    slippageText = slippage === "auto" ? `Auto (${pct})` : pct;
  }
  const minReceivedUnknown = noTaker && !isRfq && slippage === "auto";

  return (
    <div className="w-full max-w-md space-y-2 border border-border/60 bg-card/80 p-3 backdrop-blur-sm border-gradient">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold uppercase tracking-wide">Swap</h1>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={swap.refresh}
            disabled={!rawAmount || busy}
            aria-label="Refresh quote"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", (swap.isRefreshing || swap.isQuoting) && rawAmount && "animate-spin")}
            />
          </Button>
          <SwapSettings />
        </div>
      </div>

      {/* Input */}
      <div className="border border-border/50 bg-background/50 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">You pay</span>
          {connected && spendableRaw && (
            <div className="flex gap-1">
              {[
                { label: "HALF", f: 0.5 },
                { label: "MAX", f: 1 },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  disabled={busy}
                  onClick={() => setPortion(b.f)}
                  className="border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            aria-label={`Amount of ${inputToken.symbol} to pay`}
            value={inputAmount}
            disabled={busy}
            onChange={(e) => {
              const next = sanitizeAmount(e.target.value, inputToken.decimals);
              if (next !== null) setInputAmount(next);
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
          />
          <TokenButton token={inputToken} onSelect={setInputToken} disabled={busy} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">{inUsd ? `≈ ${inUsd}` : ""}</span>
          <BalanceLabel balance={inBal} connected={connected} />
        </div>
      </div>

      <div className="relative z-10 -my-3.5 flex justify-center">
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={() => switchTokens(outAmount || undefined)}
          aria-label="Switch tokens"
          className="h-8 w-8 border border-border bg-card transition-all hover:border-primary/50 hover:bg-muted"
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      {/* Output */}
      <div className="border border-border/50 bg-background/50 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">You receive</span>
        </div>
        <div className="flex items-center gap-3">
          <div
            aria-live="polite"
            title={outAmount || undefined}
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-2xl font-semibold",
              (!outAmount || swap.isStale) && "text-muted-foreground/50"
            )}
          >
            {swap.isQuoting && rawAmount ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : outAmount ? (
              formatTokenAmount(outAmount, { significant: 6, maxDecimals: 6 })
            ) : (
              "0.00"
            )}
          </div>
          <TokenButton token={outputToken} onSelect={setOutputToken} disabled={busy} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">{outUsd ? `≈ ${outUsd}` : ""}</span>
          <BalanceLabel balance={outBal} connected={connected} />
        </div>
      </div>

      <WarningBanner token={outputToken} warnings={outWarnings} />
      <WarningBanner token={inputToken} warnings={inWarnings} />

      {showDetails && order && (
        <div className="space-y-1 border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
          {rate && (
            <Row label="Rate">
              <button
                type="button"
                onClick={() => setInvertRate((v) => !v)}
                className="hover:text-primary"
                title="Invert rate"
              >
                {rate}
              </button>
            </Row>
          )}
          <Row label="Price impact">
            <span className={SEVERITY_CLASS[severity]}>{impactLabel}</span>
          </Row>
          <Row label="Minimum received">
            {minReceivedUnknown
              ? "Connect wallet to see"
              : `${formatTokenAmount(minReceived, { significant: 6, maxDecimals: 6 })} ${outputToken.symbol}`}
          </Row>
          <Row label="Slippage">{slippageText}</Row>
          {swap.feeBps !== null && (
            <Row label="Fee">
              <span className="inline-flex items-center gap-1.5">
                {swap.feeBps / 100}%
                {order.gasless && (
                  <span className="border border-primary/50 px-1 text-[10px] uppercase text-primary">
                    gasless
                  </span>
                )}
              </span>
            </Row>
          )}
          <Row label="Route">
            {[swap.router ? (ROUTER_NAMES[swap.router] ?? swap.router) : null, swap.routeLabels.join(" › ")]
              .filter(Boolean)
              .join(": ") || "—"}
          </Row>
          {severity === "high" && (
            <p className="pt-1 text-[10px] text-orange-500">
              High price impact ({impactLabel}): you get noticeably less than the market rate.
            </p>
          )}
          {swap.isStale && <p className="pt-1 text-[10px] text-yellow-500">Quote may be outdated, refreshing…</p>}
        </div>
      )}

      <Button
        onClick={handleButtonClick}
        disabled={button.action === null}
        className={cn(
          "h-12 w-full text-sm font-bold uppercase tracking-wide",
          button.tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90 glow-green",
          button.tone === "connect" && "bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-purple",
          button.tone === "danger" &&
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          button.tone === "muted" && "bg-muted text-muted-foreground"
        )}
      >
        {button.spin && <Loader2 className="h-4 w-4 animate-spin" />}
        <span className="truncate">{button.label}</span>
      </Button>
      {connected && swap.pendingSwap?.canDismiss && (
        <p className="text-center text-xs text-muted-foreground">
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
    </div>
  );
}
