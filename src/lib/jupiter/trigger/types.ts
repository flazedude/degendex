// Types for Jupiter Trigger Order API v2 (limit orders + DCA).
//
// Trigger v2 is beta: every upstream shape below is LOOSE on purpose. Fields
// beyond the documented required ones are optional, enums are widened to
// string, and nothing may assume exhaustiveness. Parse with normalize.ts.

export type TriggerFamily = "price" | "dca";
export type TriggerChallengeType = "message" | "transaction";

// ---------------------------------------------------------------------------
// Auth

export type TriggerChallengeResponse =
  | { type: "message"; challenge: string }
  | { type: "transaction"; transaction: string };

/** /auth/verify (authMode access_refresh) and /auth/refresh response. */
export interface TriggerAuthTokensRaw {
  authMode?: string;
  accessToken?: string;
  refreshToken?: string;
  /** ISO 8601. */
  expiresAt?: string;
  tokenType?: string;
}

/** Parsed tokens. expiresAt is epoch ms. */
export interface TriggerAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Vault / deposit

export interface TriggerVault {
  userPubkey?: string;
  /** May be unknown after a 409 "already registered" without details. */
  vaultPubkey?: string;
  privyVaultId?: string;
  privyUserId?: string | null;
}

export interface TriggerCraftResponse {
  /** Base64 unsigned deposit transaction. */
  transaction: string;
  /** Single-use; becomes depositRequestId on create. */
  requestId: string;
  /** The vault wallet receiving the deposit. */
  receiverAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
  inputTokenAccount?: string;
  outputTokenAccount?: string;
}

/** POST /orders/price response. */
export interface TriggerCreatePriceResponse {
  id: string;
  txSignature?: string;
  depositConfirmed?: boolean;
  message?: string;
}

/** POST /orders/dca and confirm-cancel response. */
export interface TriggerTxSignatureResponse {
  id: string;
  txSignature?: string;
}

/** POST /orders/{price|dca}/cancel/{id} response. */
export interface TriggerCancelResponse {
  id?: string;
  /** Base64 unsigned withdrawal transaction. */
  transaction: string;
  /** Becomes cancelRequestId on confirm-cancel. */
  requestId: string;
  roundsRemaining?: number;
  refundAmount?: string;
}

// ---------------------------------------------------------------------------
// History (raw)

export interface TriggerPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface PriceOrderEventRaw {
  /** deposit | fill | withdrawal | cancelled | expired (may grow). */
  type?: string;
  /** Epoch ms. */
  timestamp?: number | string;
  /** success | failed | pending. */
  state?: string;
  txSignature?: string;
  mint?: string;
  amount?: string;
  outputMint?: string;
  outputAmount?: string;
  orderContext?: string;
}

/** Item of GET /orders/history (epoch-ms timestamps). */
export interface PriceOrderRaw {
  id: string;
  /** single | oco | otoco. */
  orderType?: string;
  /** pending | open | executing | filled | pending_withdraw | cancelled | expired | failed. */
  orderState?: string;
  rawState?: string;
  userPubkey?: string;
  privyWalletPubkey?: string;
  inputMint: string;
  outputMint: string;
  triggerMint?: string;
  initialInputAmount?: string;
  remainingInputAmount?: string;
  triggerCondition?: string;
  triggerPriceUsd?: number;
  slippageBps?: number;
  expiresAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  triggeredAt?: number | null;
  outputAmount?: string | null;
  inputUsed?: string | null;
  fillPercent?: number | null;
  trailingBps?: number | null;
  events?: PriceOrderEventRaw[];
}

export interface DcaEventRaw {
  /** deposit | fill | withdrawal | cancelled (may grow). */
  type?: string;
  /** ISO 8601. */
  timestamp?: string | number;
  /** success | failed | rescheduled | pending. */
  state?: string;
  txSignature?: string;
  roundNumber?: number;
  inputAmount?: string;
  outputAmount?: string;
  attemptCount?: number;
}

/** Item of GET /orders/history/dca (ISO timestamps, different amount names). */
export interface DcaOrderRaw {
  id: string;
  requestId?: string;
  userPubkey?: string;
  vaultPubkey?: string;
  inputMint: string;
  outputMint: string;
  inputAmountInitial?: string;
  /** NOT zeroed after a cancel: reconcile from state. */
  inputAmountRemaining?: string;
  amountPerRound?: string;
  outputAmountTotal?: string;
  inputAmountUsed?: string;
  /** time_based | price_conditional. */
  orderType?: string;
  numberOfRounds?: number;
  intervalSeconds?: number;
  beginFillAt?: string;
  nextFillAt?: string | null;
  lastFillAt?: string | null;
  roundsFilled?: number;
  fillPercent?: number;
  /** depositing | deposit_failed | active | executing | withdrawing | completed | cancelled. */
  state?: string;
  /** pending | active | executing | pending_withdraw | completed | cancelled | failed. */
  displayState?: string;
  createdAt?: string;
  updatedAt?: string;
  events?: DcaEventRaw[];
}

export interface TriggerHistoryResponseRaw<T> {
  orders?: T[];
  pagination?: Partial<TriggerPagination>;
}

// ---------------------------------------------------------------------------
// Normalised row (what the UI renders)

export type TriggerOrderStatus =
  | "open"
  | "filling"
  | "filled"
  | "cancelled"
  | "expired"
  | "needs_withdraw"
  | "withdrawing"
  | "failed"
  | "unknown";

export interface TriggerOrderEvent {
  /** Raw event type (deposit, fill, withdrawal, cancelled, expired, ...). */
  type: string;
  /** Epoch ms (0 when unknown). */
  ts: number;
  txSignature?: string;
  /** Base units: input amount for deposit/fill/withdrawal. */
  amount?: string;
  /** Base units of output for fill events, when reported. */
  outputAmount?: string;
  /** Raw event state (success, failed, pending, rescheduled). */
  state?: string;
}

export interface TriggerOrderRow {
  id: string;
  family: TriggerFamily;
  /** Raw upstream state (rawState for price, state for DCA). */
  state: string;
  status: TriggerOrderStatus;
  inputMint: string;
  outputMint: string;
  /** Base units deposited. */
  inputAmountInitial: string;
  /**
   * Base units still held in the vault for this order. Forced to "0" for
   * cancelled / filled / failed orders (DCA does not zero it upstream).
   */
  inputAmountRemaining: string;
  /** Base units of output received so far, or null when not reported. */
  outputAmountReceived: string | null;
  triggerPriceUsd?: number;
  triggerCondition?: "above" | "below";
  triggerMint?: string;
  slippageBps?: number;
  /** Epoch ms. */
  expiresAt?: number;
  /** Epoch ms (0 when unknown). */
  createdAt: number;
  /** Epoch ms (0 when unknown). */
  updatedAt: number;
  /** 0..1 when reported. */
  fillPercent?: number;
  orderCount?: number;
  roundsFilled?: number;
  intervalSeconds?: number;
  /** Base units per DCA round. */
  amountPerRound?: string;
  /** Epoch ms, only while the DCA is still scheduled. */
  nextFillAt?: number;
  events: TriggerOrderEvent[];
  /** Cancel (step 1 + sign + confirm) is allowed now. */
  canCancel: boolean;
  /** Funds sit in the vault and need the cancel/withdraw flow to come back. */
  canWithdraw: boolean;
}

export interface TriggerHistoryPage {
  rows: TriggerOrderRow[];
  pagination: TriggerPagination;
}
