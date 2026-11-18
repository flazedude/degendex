"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/swap/TokenLogo";
import { getSpendableRaw, portionAmount } from "@/components/swap/swapDetails";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { formatTokenAmount, sanitizeAmount } from "@/lib/amounts";
import type { OrderSide } from "@/lib/jupiter/trigger/orders";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";

export function BetaBadge() {
  return (
    <span
      title="Jupiter Trigger API v2 is in beta"
      className="border border-yellow-500/50 px-1 text-[9px] font-semibold uppercase leading-4 tracking-wide text-yellow-500"
    >
      Beta
    </span>
  );
}

export function SideToggle({
  side,
  onChange,
  disabled,
}: {
  side: OrderSide;
  onChange: (s: OrderSide) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid flex-1 grid-cols-2 gap-1">
      {(["buy", "sell"] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={side === s}
          disabled={disabled}
          onClick={() => onChange(s)}
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
  );
}

export function DetailRow({
  label,
  children,
  title,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3" title={title}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-foreground/90">{children}</span>
    </div>
  );
}

const PORTIONS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "75%", f: 0.75 },
  { label: "100%", f: 1 },
];

/**
 * "You pay" box with balance and portion buttons. `footer` renders under the
 * input (e.g. the USD value).
 */
export function PayAmountField({
  label,
  token,
  value,
  onChange,
  disabled,
  footer,
}: {
  label: string;
  token: TokenInfo;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const bal = useTokenBalance(token);
  const spendable = useMemo(() => getSpendableRaw(bal.raw, token.mint), [bal.raw, token.mint]);
  const balanceText = bal.ui !== undefined ? formatTokenAmount(bal.ui) : bal.isLoading ? "…" : "—";

  return (
    <div className="space-y-1">
      <div className="border border-border/50 bg-background/50 px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wide">{label}</span>
          <span className="font-mono" title={bal.ui}>
            Bal: {balanceText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            aria-label={`Amount of ${token.symbol} to pay`}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const next = sanitizeAmount(e.target.value, token.decimals);
              if (next !== null) onChange(next);
            }}
            className="min-w-0 flex-1 bg-transparent py-0.5 font-mono text-base font-semibold outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
          />
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold">
            <TokenLogo symbol={token.symbol} logoURI={token.logoURI} className="h-4 w-4 text-[9px]" />
            <span className="max-w-[5.5rem] truncate">{token.symbol}</span>
          </span>
        </div>
        <div className="h-3.5 font-mono text-[10px] leading-3.5 text-muted-foreground">{footer}</div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {PORTIONS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled || !spendable || spendable.isZero()}
            onClick={() => spendable && onChange(portionAmount(spendable, p.f, token.decimals))}
            className="border border-border/50 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors enabled:hover:border-primary/60 enabled:hover:text-primary disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small segmented choice (expiry, interval). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex-1 border px-1 py-0.5 text-[10px] transition-colors disabled:opacity-50",
            value === o.id
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border/50 text-muted-foreground enabled:hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Notes under the details: warnings in yellow, the last action's error in red. */
export function FormNotes({ warnings, error }: { warnings: string[]; error: string | null }) {
  if (warnings.length === 0 && !error) return null;
  return (
    <div className="space-y-1 text-[10px] leading-snug">
      {warnings.map((w) => (
        <p key={w} className="text-yellow-500">
          {w}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Short reasons fit the button; long ones go in a note above it. */
export function isShortReason(reason: string | null): boolean {
  return !!reason && reason.length <= 32;
}

export function SubmitButton({
  side,
  label,
  blocker,
  busyLabel,
  busy,
  otherBusy,
  otherBusyReason,
  onClick,
}: {
  side: OrderSide;
  label: string;
  blocker: string | null;
  busyLabel: string;
  /** This form's action is running. */
  busy: boolean;
  /** Another order action is running (or new orders are on hold). */
  otherBusy: boolean;
  /** Why, e.g. "Finish the withdrawal first". */
  otherBusyReason?: string | null;
  onClick: () => void;
}) {
  const reason = otherBusy ? (otherBusyReason ?? "Another order action is running") : null;
  const longReason = reason && !isShortReason(reason) ? reason : null;
  const longBlocker = !reason && blocker && !isShortReason(blocker) ? blocker : null;
  const text = busy
    ? busyLabel
    : reason
      ? longReason
        ? "Please wait"
        : reason
      : blocker && !longBlocker
        ? blocker
        : label;
  const disabled = busy || otherBusy || !!blocker;
  return (
    <div className="space-y-1">
      {(longReason ?? longBlocker) && !busy && (
        <p className="text-[10px] leading-snug text-yellow-500" role="status">
          {longReason ?? longBlocker}
        </p>
      )}
      <Button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "h-9 w-full rounded-none text-xs font-bold uppercase tracking-wide",
          disabled
            ? "bg-muted text-muted-foreground"
            : side === "buy"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
        )}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span className="truncate">{text}</span>
      </Button>
    </div>
  );
}
