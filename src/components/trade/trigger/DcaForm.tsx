"use client";

import { useMemo, useState } from "react";
import { TokenWarningBanner } from "@/components/swap/TokenWarningBanner";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useTriggerActions } from "@/hooks/useTriggerActions";
import { useTriggerOrders } from "@/hooks/useTriggerOrders";
import { formatUsd } from "@/lib/amounts";
import { MAX_ACTIVE_DCA, NEW_ORDERS_ENABLED, TRIGGER_MIN_USD, TRIGGER_MODE } from "@/lib/jupiter/trigger/config";
import { formatUsdBelow, type OrderSide } from "@/lib/jupiter/trigger/orders";
import { UNKNOWN_ORDER_HOLD_MESSAGE } from "@/lib/jupiter/trigger/actionResult";
import { getTokenWarnings } from "@/lib/tokens/risk";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
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
import { formatDuration, formatInterval, minimumText } from "./triggerFormat";
import {
  DEFAULT_INTERVAL,
  INTERVAL_OPTIONS,
  TOKEN_2022_PROGRAM,
  dcaFormView,
  liveBasePrice,
  payToken,
  receiveToken,
  type IntervalChoice,
} from "./triggerForms";

const INLINE_CODES = new Set(["validation", "busy", "auth", "disabled"]);

/** Time-based DCA of `base` against USDC on Jupiter Trigger v2. */
export function DcaForm({ base }: { base: TokenInfo }) {
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [orderCount, setOrderCount] = useState("4");
  const [interval, setIntervalChoice] = useState<IntervalChoice>(DEFAULT_INTERVAL);
  const [customHours, setCustomHours] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formMint, setFormMint] = useState(base.mint);
  if (formMint !== base.mint) {
    setFormMint(base.mint);
    setAmount("");
    setFormError(null);
  }

  const detail = useMarketDetail(base.mint);
  const market = liveBasePrice(base, detail);
  const pay = payToken(base, side);
  const receive = receiveToken(base, side);
  const bal = useTokenBalance(pay);
  const orders = useTriggerOrders();
  const actions = useTriggerActions();
  const busy = actions.pending?.kind === "dca";
  const otherBusy = (actions.isBusy && !busy) || actions.newOrdersHeld;
  // Unknown until the active list has loaded once.
  const activeDcaCount = orders.enabled && !orders.isLoading && !orders.error ? orders.activeDcaCount : null;

  const view = dcaFormView({
    base,
    side,
    totalAmount: amount,
    orderCount,
    interval,
    customHours,
    marketPriceUsd: market.priceUsd,
    balanceRaw: bal.raw,
    activeDcaCount,
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
    setAmount("");
    setFormError(null);
  };

  const submit = async () => {
    if (view.blocker || view.orderCount === null || view.intervalSeconds === null) return;
    setFormError(null);
    const result = await actions.placeDca({
      base,
      side,
      totalPayUi: amount,
      orderCount: view.orderCount,
      intervalSeconds: view.intervalSeconds,
      currentPriceUsd: market.stale ? null : market.priceUsd,
    });
    if (result.ok) {
      setAmount("");
      return;
    }
    if (INLINE_CODES.has(result.code)) setFormError(result.error);
  };

  const totalUsd = formatUsd(view.totalUsd);
  const perRoundUsd = formatUsdBelow(view.perRoundUsd);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>DCA · {base.symbol}/USDC</span>
        <BetaBadge />
      </div>
      {!NEW_ORDERS_ENABLED ? (
        <TriggerUnavailable
          kind={TRIGGER_MODE === "off" ? "off" : "new-orders"}
          className="border border-border/50 bg-background/30 p-3"
        />
      ) : (
        <TriggerGate intro={`Split a ${base.symbol} buy or sell into rounds over time. Orders run on Jupiter.`}>
          <div className="space-y-2">
            <SideToggle side={side} onChange={changeSide} disabled={busy} />

            <PayAmountField
              label="Total you pay"
              token={pay}
              value={amount}
              onChange={edit(setAmount)}
              disabled={busy}
              footer={totalUsd ? `≈ ${totalUsd}` : ""}
            />

            <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Orders</span>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Number of orders"
                  value={orderCount}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                    edit(setOrderCount)(v);
                  }}
                  className="h-[22px] w-full border border-border/50 bg-background/50 px-1.5 font-mono text-[11px] outline-none focus:border-primary/60 disabled:opacity-60"
                />
              </label>
              <div className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Every</span>
                <Segmented
                  ariaLabel="Interval between orders"
                  options={INTERVAL_OPTIONS}
                  value={interval}
                  onChange={edit(setIntervalChoice)}
                  disabled={busy}
                />
              </div>
            </div>

            {interval === "custom" && (
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="shrink-0">Every</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label="Custom interval in hours"
                  placeholder="e.g. 4"
                  value={customHours}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value.replace(",", ".");
                    if (/^\d{0,4}(?:\.\d{0,3})?$/.test(v)) edit(setCustomHours)(v);
                  }}
                  className="h-[22px] w-20 border border-border/50 bg-background/50 px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary/60 disabled:opacity-60"
                />
                <span>hours (1 min to 1 year)</span>
              </label>
            )}

            <div className="space-y-0.5 border border-border/40 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground">
              <DetailRow label="Per round">
                {view.perRound ? `${view.perRound} ${pay.symbol}` : "—"}
              </DetailRow>
              <DetailRow label="Value per round">
                <span className={cn(view.belowMinimum && "text-yellow-500")}>
                  {perRoundUsd ? `≈ ${perRoundUsd}` : "—"} ({minimumText(TRIGGER_MIN_USD, view.nearMinimum)})
                </span>
              </DetailRow>
              <DetailRow label="Schedule">
                {view.orderCount && view.intervalSeconds
                  ? `${view.orderCount} rounds ${formatInterval(view.intervalSeconds)}`
                  : "—"}
              </DetailRow>
              <DetailRow label="Last round in">
                {view.durationSeconds !== null ? `≈ ${formatDuration(view.durationSeconds)}` : "—"}
              </DetailRow>
              <DetailRow label="You receive">{receive.symbol} at each round&apos;s market price</DetailRow>
              <DetailRow label="Active DCA orders">
                <span className={cn(view.atCap && "text-yellow-500")}>
                  {activeDcaCount ?? "—"} / {MAX_ACTIVE_DCA}
                </span>
              </DetailRow>
              <p className="pt-0.5 leading-snug">
                The first round runs right away. A DCA cannot be edited or paused; cancelling it withdraws the
                unfilled remainder.
              </p>
              <p className="pt-0.5 leading-snug">
                <FeesNote />
              </p>
            </div>

            <FormNotes warnings={notes} error={formError} />
            <TokenWarningBanner token={base} warnings={warnings} compact />

            <SubmitButton
              side={side}
              label={`Start DCA ${side}`}
              blocker={view.blocker}
              busy={busy}
              busyLabel="Starting DCA..."
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
