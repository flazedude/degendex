"use client";

import { useMemo, useState } from "react";
import { TokenWarningBanner } from "@/components/swap/TokenWarningBanner";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useTriggerActions } from "@/hooks/useTriggerActions";
import { sanitizeAmount } from "@/lib/amounts";
import { USDC_MINT } from "@/lib/constants";
import { NEW_ORDERS_ENABLED, TRIGGER_MIN_USD, TRIGGER_MODE } from "@/lib/jupiter/trigger/config";
import { formatUsdBelow, type OrderSide } from "@/lib/jupiter/trigger/orders";
import { UNKNOWN_ORDER_HOLD_MESSAGE } from "@/lib/jupiter/trigger/actionResult";
import { getTokenWarnings } from "@/lib/tokens/risk";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { formatPct, formatUsdPrice } from "../tradesFormat";
import { FeesNote, TriggerGate, TriggerUnavailable } from "./TriggerConsentDialog";
import {
  BetaBadge,
  DetailRow,
  FormNotes,
  PayAmountField,
  Segmented,
  SideToggle,
  SubmitButton,
} from "./formParts";
import { minimumText, offsetPrice } from "./triggerFormat";
import {
  DEFAULT_EXPIRY,
  EXPIRY_OPTIONS,
  expiryMs,
  limitFormView,
  liveBasePrice,
  TOKEN_2022_PROGRAM,
  payToken,
  receiveToken,
  triggerOffsets,
  type ExpiryChoice,
} from "./triggerForms";


/** Inline (not toasted) result codes; everything else is toasted by the hook. */
const INLINE_CODES = new Set(["validation", "busy", "auth", "disabled"]);

/**
 * Limit buy / sell of `base` against USDC on Jupiter Trigger v2. The trigger
 * is the USD price of `base`.
 */
export function LimitOrderForm({ base }: { base: TokenInfo }) {
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [trigger, setTrigger] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY);
  const [formError, setFormError] = useState<string | null>(null);
  // A new market starts clean (adjust-state-on-prop-change, no effect).
  const [formMint, setFormMint] = useState(base.mint);
  if (formMint !== base.mint) {
    setFormMint(base.mint);
    setAmount("");
    setTrigger("");
    setFormError(null);
  }

  const detail = useMarketDetail(base.mint);
  const market = liveBasePrice(base, detail);
  const pay = payToken(base, side);
  const receive = receiveToken(base, side);
  const bal = useTokenBalance(pay);
  // Jupiter values a USDC deposit at USDC's live price (not exactly $1).
  const usdcPrices = useTokenPrices(side === "buy" ? [USDC_MINT] : []);
  const usdcPriceUsd = side === "buy" ? (usdcPrices.data?.[USDC_MINT]?.usdPrice ?? null) : null;
  const actions = useTriggerActions();
  const busy = actions.pending?.kind === "limit";
  const otherBusy = (actions.isBusy && !busy) || actions.newOrdersHeld;

  const view = limitFormView({
    base,
    side,
    payAmount: amount,
    triggerPrice: trigger,
    expiry,
    marketPriceUsd: market.priceUsd,
    marketStale: market.stale,
    usdcPriceUsd,
    balanceRaw: bal.raw,
  });
  const warnings = useMemo(() => getTokenWarnings(base).filter((w) => w.level !== "info"), [base]);
  const notes = [...view.warnings];
  if (detail.data?.tokenProgram === TOKEN_2022_PROGRAM) {
    notes.push("Token-2022 token: Jupiter rejects tokens with transfer fees or transfer hooks.");
  }

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setFormError(null);
  };

  const changeSide = (next: OrderSide) => {
    if (next === side) return;
    setSide(next);
    // The amount is in what you pay and the trigger flips side: start over.
    setAmount("");
    setTrigger("");
    setFormError(null);
  };

  const submit = async () => {
    if (view.blocker || view.triggerPriceUsd === null) return;
    setFormError(null);
    const result = await actions.placeLimitOrder({
      base,
      side,
      payAmountUi: amount,
      triggerPriceUsd: view.triggerPriceUsd,
      expiresInMs: expiryMs(expiry),
      // A delayed price is not passed: the hook then fetches a fresh one.
      currentPriceUsd: market.stale ? null : market.priceUsd,
      usdcPriceUsd,
    });
    if (result.ok) {
      setAmount("");
      return;
    }
    if (INLINE_CODES.has(result.code)) setFormError(result.error);
  };

  const verb = side === "buy" ? "Buy" : "Sell";
  const expiryLabel = EXPIRY_OPTIONS.find((o) => o.id === expiry)?.label ?? "";
  const dist = view.distancePct;
  const usdText = formatUsdBelow(view.depositUsd);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Limit order · {base.symbol}/USDC</span>
        <BetaBadge />
      </div>
      {!NEW_ORDERS_ENABLED ? (
        <TriggerUnavailable
          kind={TRIGGER_MODE === "off" ? "off" : "new-orders"}
          className="border border-border/50 bg-background/30 p-3"
        />
      ) : (
        <TriggerGate intro={`Buy or sell ${base.symbol} at your price. Orders run on Jupiter.`}>
          <div className="space-y-2">
            <SideToggle side={side} onChange={changeSide} disabled={busy} />

            <PayAmountField
              label="You pay"
              token={pay}
              value={amount}
              onChange={edit(setAmount)}
              disabled={busy}
              footer={
                <span className={cn(view.belowMinimum && "text-yellow-500")}>
                  {usdText ? `≈ ${usdText}` : ""}
                  {usdText ? " · " : ""}
                  {minimumText(TRIGGER_MIN_USD, view.nearMinimum)}
                </span>
              }
            />

            {/* Trigger price */}
            <div className="border border-border/50 bg-background/50 px-2 py-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="uppercase tracking-wide">
                  {side === "buy" ? "Buy when price ≤" : "Sell when price ≥"}
                </span>
                <span className="font-mono">
                  Now {formatUsdPrice(market.priceUsd)}
                  {market.stale && market.priceUsd !== null && (
                    <span className="ml-1 text-yellow-500" title="Price data is delayed">
                      Delayed
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0.00"
                  aria-label={`Trigger price of ${base.symbol} in USD`}
                  value={trigger}
                  disabled={busy}
                  onChange={(e) => {
                    const next = sanitizeAmount(e.target.value, 12);
                    if (next !== null) edit(setTrigger)(next);
                  }}
                  className="min-w-0 flex-1 bg-transparent py-0.5 font-mono text-base font-semibold outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
                />
                <span
                  className={cn(
                    "shrink-0 font-mono text-[10px]",
                    dist === null
                      ? "text-muted-foreground"
                      : (side === "buy" && dist < 0) || (side === "sell" && dist > 0)
                        ? "text-foreground/80"
                        : "text-yellow-500"
                  )}
                  title="Distance from the current price"
                >
                  {dist === null ? "" : formatPct(dist)}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {triggerOffsets(side).map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={busy || market.priceUsd === null}
                    onClick={() => edit(setTrigger)(offsetPrice(market.priceUsd, pct))}
                    className="border border-border/50 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors enabled:hover:border-primary/60 enabled:hover:text-primary disabled:opacity-50"
                  >
                    {pct > 0 ? `+${pct}` : pct}%
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Expires in</div>
              <Segmented
                ariaLabel="Order expiry"
                options={EXPIRY_OPTIONS}
                value={expiry}
                onChange={edit(setExpiry)}
                disabled={busy}
              />
            </div>

            <div className="space-y-0.5 border border-border/40 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground">
              <DetailRow label="You receive">
                {view.estReceive ? (
                  <>
                    ≈ {view.estReceive} {receive.symbol}{" "}
                    <span className="text-muted-foreground">at trigger price</span>
                  </>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Trigger">{base.symbol} USD price (Jupiter)</DetailRow>
              <DetailRow label="Slippage">Auto (Jupiter)</DetailRow>
              {view.estReceive && view.triggerPriceUsd !== null && (
                <p className="pt-0.5 leading-snug text-foreground/80">
                  {verb} {side === "buy" ? `≈ ${view.estReceive} ${base.symbol}` : `${amount} ${base.symbol}`} when{" "}
                  {base.symbol} {side === "buy" ? "falls to" : "rises to"} {formatUsdPrice(view.triggerPriceUsd)}.
                  Expires in {expiryLabel}; if it hasn&apos;t filled by then, withdraw it from Open orders.
                </p>
              )}
              <p className="pt-0.5 leading-snug">
                <FeesNote />
              </p>
            </div>

            <FormNotes warnings={notes} error={formError} />
            <TokenWarningBanner token={base} warnings={warnings} compact />

            <SubmitButton
              side={side}
              label={`Place limit ${side}`}
              blocker={view.blocker}
              busy={busy}
              busyLabel="Placing order..."
              otherBusy={otherBusy}
              otherBusyReason={actions.isBusy && !busy ? actions.busyReason : UNKNOWN_ORDER_HOLD_MESSAGE}
              onClick={() => void submit()}
            />
          </div>
        </TriggerGate>
      )}
    </div>
  );
}
