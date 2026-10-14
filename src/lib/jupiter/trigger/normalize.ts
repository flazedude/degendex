// Normalises Trigger v2 history rows (price + DCA) into one TriggerOrderRow.
//
// The two families differ: price history uses epoch-ms numbers and
// initialInputAmount/remainingInputAmount, DCA uses ISO strings and
// inputAmountInitial/inputAmountRemaining. States differ too. Trigger v2 is
// beta, so every field is parsed defensively and unknown states map to
// status "unknown" instead of throwing.

import type {
  TriggerFamily,
  TriggerHistoryPage,
  TriggerOrderEvent,
  TriggerOrderRow,
  TriggerOrderStatus,
  TriggerPagination,
} from "./types";

type Obj = Record<string, unknown>;

const DIGITS_RE = /^\d{1,30}$/;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Base-unit amount string, or undefined for anything that is not digits. */
function amount(v: unknown): string | undefined {
  if (typeof v === "string" && DIGITS_RE.test(v)) return v.replace(/^0+(?=\d)/, "");
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return undefined;
}

/** Epoch ms from a number (ms, or seconds if implausibly small) or ISO string. */
function timeMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Guard against a seconds-based timestamp sneaking in.
    return v < 1e11 ? v * 1000 : v;
  }
  if (typeof v === "string" && v) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

function isPositive(raw: string): boolean {
  return /[1-9]/.test(raw);
}

function sumAmounts(values: (string | undefined)[]): string | null {
  let total = BigInt(0);
  let any = false;
  for (const v of values) {
    if (v === undefined) continue;
    total += BigInt(v);
    any = true;
  }
  return any ? total.toString() : null;
}

interface StatusInfo {
  status: TriggerOrderStatus;
  canCancel: boolean;
}

// --- Price orders ------------------------------------------------------------

/** rawState -> status (order-history.md "Raw States" table). */
const PRICE_RAW_STATES: Record<string, StatusInfo> = {
  pending_deposit: { status: "open", canCancel: false },
  depositing: { status: "open", canCancel: false },
  open: { status: "open", canCancel: true },
  ready_execute: { status: "filling", canCancel: false },
  executing: { status: "filling", canCancel: false },
  execute_success: { status: "filling", canCancel: false },
  execute_failed: { status: "filling", canCancel: false },
  ready_withdraw_output: { status: "filling", canCancel: false },
  // Price "withdrawing" is the keeper paying OUT the filled output, not a user
  // withdrawal.
  withdrawing: { status: "filling", canCancel: false },
  // The filled part has settled; the remainder stays live and can be cancelled.
  partial_fill_success: { status: "filling", canCancel: true },
  // Expiry detected, still processing: the Withdraw flow is not ready yet.
  ready_expire: { status: "expired", canCancel: false },
  fill_success: { status: "filled", canCancel: false },
  ready_to_cancel: { status: "needs_withdraw", canCancel: false },
  cancelled: { status: "cancelled", canCancel: false },
  oco_cancelled: { status: "cancelled", canCancel: false },
  expired: { status: "expired", canCancel: false },
  deposit_failed: { status: "failed", canCancel: false },
  withdraw_failed: { status: "failed", canCancel: false },
  fill_failed: { status: "failed", canCancel: false },
};

/** orderState (display) fallback when rawState is missing or new. */
const PRICE_DISPLAY_STATES: Record<string, StatusInfo> = {
  pending: { status: "open", canCancel: false },
  open: { status: "open", canCancel: true },
  executing: { status: "filling", canCancel: false },
  filled: { status: "filled", canCancel: false },
  pending_withdraw: { status: "needs_withdraw", canCancel: false },
  cancelled: { status: "cancelled", canCancel: false },
  expired: { status: "expired", canCancel: false },
  failed: { status: "failed", canCancel: false },
};

// --- DCA orders --------------------------------------------------------------

/** state -> status (dca-history.md "Order states" table). */
const DCA_STATES: Record<string, StatusInfo> = {
  depositing: { status: "open", canCancel: false },
  active: { status: "open", canCancel: true },
  executing: { status: "filling", canCancel: false },
  // Cancel step 1 done: funds wait in the vault for a signed withdrawal.
  withdrawing: { status: "withdrawing", canCancel: false },
  completed: { status: "filled", canCancel: false },
  cancelled: { status: "cancelled", canCancel: false },
  deposit_failed: { status: "failed", canCancel: false },
};

const DCA_DISPLAY_STATES: Record<string, StatusInfo> = {
  pending: { status: "open", canCancel: false },
  active: { status: "open", canCancel: true },
  executing: { status: "filling", canCancel: false },
  pending_withdraw: { status: "withdrawing", canCancel: false },
  completed: { status: "filled", canCancel: false },
  cancelled: { status: "cancelled", canCancel: false },
  failed: { status: "failed", canCancel: false },
};

const TERMINAL: ReadonlySet<TriggerOrderStatus> = new Set(["filled", "cancelled", "failed"]);

function resolveStatus(
  raw: string | undefined,
  display: string | undefined,
  rawTable: Record<string, StatusInfo>,
  displayTable: Record<string, StatusInfo>
): StatusInfo {
  if (raw && Object.prototype.hasOwnProperty.call(rawTable, raw)) return rawTable[raw];
  if (display && Object.prototype.hasOwnProperty.call(displayTable, display)) {
    return displayTable[display];
  }
  return { status: "unknown", canCancel: false };
}

/** Whether funds wait in the vault for the user-signed withdraw flow. */
function computeCanWithdraw(status: TriggerOrderStatus, remaining: string): boolean {
  switch (status) {
    case "needs_withdraw":
    case "withdrawing":
      return true;
    case "expired":
      // Expired orders never auto-refund. ready_expire is caught by the caller.
      return isPositive(remaining);
    case "unknown":
      // A new upstream state: offer Withdraw only if funds clearly remain (the
      // server refuses if the state is not withdrawable; nothing is lost).
      return isPositive(remaining);
    default:
      return false;
  }
}

function parsePriceEvents(v: unknown): TriggerOrderEvent[] {
  if (!Array.isArray(v)) return [];
  const out: TriggerOrderEvent[] = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    const ev: TriggerOrderEvent = { type: str(e.type) ?? "unknown", ts: timeMs(e.timestamp) ?? 0 };
    const sig = str(e.txSignature);
    if (sig) ev.txSignature = sig;
    const amt = amount(e.amount);
    if (amt !== undefined) ev.amount = amt;
    const outAmt = amount(e.outputAmount);
    if (outAmt !== undefined) ev.outputAmount = outAmt;
    const state = str(e.state);
    if (state) ev.state = state;
    out.push(ev);
  }
  return out;
}

function parseDcaEvents(v: unknown): TriggerOrderEvent[] {
  if (!Array.isArray(v)) return [];
  const out: TriggerOrderEvent[] = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    const ev: TriggerOrderEvent = { type: str(e.type) ?? "unknown", ts: timeMs(e.timestamp) ?? 0 };
    const sig = str(e.txSignature);
    if (sig) ev.txSignature = sig;
    const amt = amount(e.inputAmount) ?? amount(e.amount);
    if (amt !== undefined) ev.amount = amt;
    const outAmt = amount(e.outputAmount);
    if (outAmt !== undefined) ev.outputAmount = outAmt;
    const state = str(e.state);
    if (state) ev.state = state;
    out.push(ev);
  }
  return out;
}

function successfulFillOutputs(events: TriggerOrderEvent[]): string | null {
  return sumAmounts(
    events
      .filter((e) => e.type === "fill" && (e.state === undefined || e.state === "success"))
      .map((e) => e.outputAmount)
  );
}

/** Normalises one GET /orders/history item. Returns null if unusable. */
export function normalizePriceOrder(raw: unknown): TriggerOrderRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const inputMint = str(raw.inputMint);
  const outputMint = str(raw.outputMint);
  if (!id || !inputMint || !outputMint) return null;

  const rawState = str(raw.rawState);
  const orderState = str(raw.orderState);
  const info = resolveStatus(rawState, orderState, PRICE_RAW_STATES, PRICE_DISPLAY_STATES);

  const initial = amount(raw.initialInputAmount) ?? "0";
  const remainingReported = amount(raw.remainingInputAmount) ?? initial;
  const remaining = TERMINAL.has(info.status) ? "0" : remainingReported;
  const events = parsePriceEvents(raw.events);

  const row: TriggerOrderRow = {
    id,
    family: "price",
    state: rawState ?? orderState ?? "unknown",
    status: info.status,
    inputMint,
    outputMint,
    inputAmountInitial: initial,
    inputAmountRemaining: remaining,
    outputAmountReceived: amount(raw.outputAmount) ?? successfulFillOutputs(events),
    createdAt: timeMs(raw.createdAt) ?? 0,
    updatedAt: timeMs(raw.updatedAt) ?? timeMs(raw.createdAt) ?? 0,
    events,
    canCancel: info.canCancel,
    canWithdraw: rawState === "ready_expire" ? false : computeCanWithdraw(info.status, remaining),
  };
  const triggerPriceUsd = num(raw.triggerPriceUsd);
  if (triggerPriceUsd !== undefined) row.triggerPriceUsd = triggerPriceUsd;
  if (raw.triggerCondition === "above" || raw.triggerCondition === "below") {
    row.triggerCondition = raw.triggerCondition;
  }
  const triggerMint = str(raw.triggerMint);
  if (triggerMint) row.triggerMint = triggerMint;
  const slippageBps = num(raw.slippageBps);
  if (slippageBps !== undefined) row.slippageBps = slippageBps;
  const expiresAt = timeMs(raw.expiresAt);
  if (expiresAt !== undefined) row.expiresAt = expiresAt;
  const fillPercent = num(raw.fillPercent);
  if (fillPercent !== undefined) row.fillPercent = fillPercent;
  return row;
}

/** Normalises one GET /orders/history/dca item. Returns null if unusable. */
export function normalizeDcaOrder(raw: unknown): TriggerOrderRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const inputMint = str(raw.inputMint);
  const outputMint = str(raw.outputMint);
  if (!id || !inputMint || !outputMint) return null;

  const state = str(raw.state);
  const displayState = str(raw.displayState);
  const info = resolveStatus(state, displayState, DCA_STATES, DCA_DISPLAY_STATES);

  const initial = amount(raw.inputAmountInitial) ?? "0";
  const remainingReported = amount(raw.inputAmountRemaining) ?? initial;
  // inputAmountRemaining is not zeroed after a cancel: trust the state.
  const remaining = TERMINAL.has(info.status) ? "0" : remainingReported;
  const events = parseDcaEvents(raw.events);

  const row: TriggerOrderRow = {
    id,
    family: "dca",
    state: state ?? displayState ?? "unknown",
    status: info.status,
    inputMint,
    outputMint,
    inputAmountInitial: initial,
    inputAmountRemaining: remaining,
    outputAmountReceived: amount(raw.outputAmountTotal) ?? successfulFillOutputs(events),
    createdAt: timeMs(raw.createdAt) ?? 0,
    updatedAt: timeMs(raw.updatedAt) ?? timeMs(raw.createdAt) ?? 0,
    events,
    canCancel: info.canCancel,
    canWithdraw: computeCanWithdraw(info.status, remaining),
  };
  const orderCount = num(raw.numberOfRounds);
  if (orderCount !== undefined) row.orderCount = orderCount;
  const roundsFilled = num(raw.roundsFilled);
  if (roundsFilled !== undefined) row.roundsFilled = roundsFilled;
  const intervalSeconds = num(raw.intervalSeconds);
  if (intervalSeconds !== undefined) row.intervalSeconds = intervalSeconds;
  const perRound = amount(raw.amountPerRound);
  if (perRound !== undefined) row.amountPerRound = perRound;
  const fillPercent = num(raw.fillPercent);
  if (fillPercent !== undefined) row.fillPercent = fillPercent;
  if (info.status === "open" || info.status === "filling") {
    const next = timeMs(raw.nextFillAt);
    if (next !== undefined) row.nextFillAt = next;
  }
  return row;
}

export function normalizeOrder(family: TriggerFamily, raw: unknown): TriggerOrderRow | null {
  return family === "price" ? normalizePriceOrder(raw) : normalizeDcaOrder(raw);
}

/** Parses a history list response ({ orders, pagination }) loosely. */
export function parseHistoryPage(family: TriggerFamily, body: unknown): TriggerHistoryPage {
  const orders = isObj(body) && Array.isArray(body.orders) ? body.orders : [];
  const rows: TriggerOrderRow[] = [];
  for (const o of orders) {
    const row = normalizeOrder(family, o);
    if (row) rows.push(row);
  }
  const p = isObj(body) && isObj(body.pagination) ? body.pagination : {};
  const pagination: TriggerPagination = {
    total: Math.max(num(p.total) ?? rows.length, rows.length),
    limit: num(p.limit) ?? rows.length,
    offset: num(p.offset) ?? 0,
  };
  return { rows, pagination };
}

/** Rows whose funds wait in the vault for a Withdraw (deduped by family+id). */
export function selectNeedsWithdraw(rows: readonly TriggerOrderRow[]): TriggerOrderRow[] {
  const seen = new Set<string>();
  const out: TriggerOrderRow[] = [];
  for (const r of rows) {
    if (!r.canWithdraw) continue;
    const key = `${r.family}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** DCA orders that count toward Jupiter's 10-active cap (withdrawing included). */
export function countActiveDca(rows: readonly TriggerOrderRow[]): number {
  return rows.filter(
    (r) => r.family === "dca" && !TERMINAL.has(r.status) && r.status !== "expired"
  ).length;
}
