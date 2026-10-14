import { describe, expect, it } from "vitest";
import {
  countActiveDca,
  normalizeDcaOrder,
  normalizePriceOrder,
  parseHistoryPage,
  selectNeedsWithdraw,
} from "./normalize";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// order-history.md response sample
const PRICE_DOC = {
  id: "order-uuid",
  orderType: "single",
  orderState: "open",
  rawState: "open",
  userPubkey: "YourWalletPublicKey...",
  privyWalletPubkey: "VaultPublicKey...",
  inputMint: SOL,
  initialInputAmount: "1000000000",
  remainingInputAmount: "1000000000",
  outputMint: USDC,
  triggerMint: SOL,
  triggerCondition: "above",
  triggerPriceUsd: 200.0,
  slippageBps: 100,
  expiresAt: 1704067200000,
  createdAt: 1704000000000,
  updatedAt: 1704000000000,
  events: [
    {
      type: "deposit",
      timestamp: 1704000000000,
      txSignature: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      mint: SOL,
      amount: "1000000000",
      state: "success",
    },
  ],
};

// OpenAPI /orders/history/dca/{id} example
const DCA_DOC = {
  id: "019f053d-3f0c-70ad-bb5e-76d633291f80",
  requestId: "1cc1ad82-866e-492d-a092-18859565945d",
  userPubkey: "8gs8rXavMQRqoAoMhCfo79r2wndgSn93FLSWErdHp82n",
  vaultPubkey: "66xK9AE6oFpGAyn9eCWE3LtYwUZKkeUxbfjFSNmFnkBo",
  inputMint: USDC,
  outputMint: SOL,
  inputAmountInitial: "20000000",
  inputAmountRemaining: "10000000",
  amountPerRound: "10000000",
  outputAmountTotal: "137589159",
  inputAmountUsed: "10000000",
  orderType: "time_based",
  minPriceUsd: null,
  maxPriceUsd: null,
  triggerMint: null,
  retryWindowSeconds: 1800,
  jlEnabled: false,
  jlYieldUsd: null,
  numberOfRounds: 2,
  intervalSeconds: 3600,
  beginFillAt: "2026-06-26T18:42:07.750Z",
  nextFillAt: "2026-06-26T19:44:57.469Z",
  lastFillAt: "2026-06-26T18:42:11.469Z",
  roundsFilled: 1,
  fillPercent: 0.5,
  state: "active",
  displayState: "active",
  createdAt: "2026-06-26T18:42:07.782Z",
  updatedAt: "2026-06-26T18:42:11.469Z",
  events: [
    {
      type: "fill",
      timestamp: "2026-06-26T18:42:11.469Z",
      txSignature: "HuNMpjFkTjVrCYMN6gTPWV9ay3GSxTxM7sZj4WNzjvzQoe4J5CR71MnTpuMKH9rtkDoDCTWu6rYRM12oR9cpbb4",
      roundNumber: 1,
      inputAmount: "10000000",
      outputAmount: "137589159",
      state: "success",
    },
    {
      type: "deposit",
      timestamp: "2026-06-26T18:42:08.880Z",
      txSignature: "32hAuVdZ57y5TUEx4vdV75zJyTqoCVqAby4eiayrmUW1TCuwoAvPRBcnhPMLN1YpfCp4Rc6HiLXKsi3NF5iWVcrn",
      inputAmount: "20000000",
      state: "success",
    },
  ],
};

describe("normalizePriceOrder", () => {
  it("maps the documented sample", () => {
    expect(normalizePriceOrder(PRICE_DOC)).toEqual({
      id: "order-uuid",
      family: "price",
      state: "open",
      status: "open",
      inputMint: SOL,
      outputMint: USDC,
      inputAmountInitial: "1000000000",
      inputAmountRemaining: "1000000000",
      outputAmountReceived: null,
      triggerPriceUsd: 200,
      triggerCondition: "above",
      triggerMint: SOL,
      slippageBps: 100,
      expiresAt: 1704067200000,
      createdAt: 1704000000000,
      updatedAt: 1704000000000,
      events: [
        {
          type: "deposit",
          ts: 1704000000000,
          txSignature: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
          amount: "1000000000",
          state: "success",
        },
      ],
      canCancel: true,
      canWithdraw: false,
    });
  });

  it("maps every documented raw state", () => {
    const table: [string, string, boolean, boolean][] = [
      // rawState, status, canCancel, canWithdraw
      ["pending_deposit", "open", false, false],
      ["depositing", "open", false, false],
      ["open", "open", true, false],
      ["ready_execute", "filling", false, false],
      ["ready_expire", "expired", false, false],
      ["executing", "filling", false, false],
      ["execute_success", "filling", false, false],
      ["execute_failed", "filling", false, false],
      ["ready_withdraw_output", "filling", false, false],
      ["withdrawing", "filling", false, false],
      ["fill_success", "filled", false, false],
      ["partial_fill_success", "filling", true, false],
      ["ready_to_cancel", "needs_withdraw", false, true],
      ["cancelled", "cancelled", false, false],
      ["oco_cancelled", "cancelled", false, false],
      ["expired", "expired", false, true],
      ["deposit_failed", "failed", false, false],
      ["withdraw_failed", "failed", false, false],
      ["fill_failed", "failed", false, false],
    ];
    for (const [rawState, status, canCancel, canWithdraw] of table) {
      const row = normalizePriceOrder({ ...PRICE_DOC, rawState, orderState: "whatever" })!;
      expect([row.state, row.status, row.canCancel, row.canWithdraw], rawState).toEqual([
        rawState,
        status,
        canCancel,
        canWithdraw,
      ]);
    }
  });

  it("expired with nothing left is not withdrawable; terminal rows hold nothing", () => {
    const expiredEmpty = normalizePriceOrder({ ...PRICE_DOC, rawState: "expired", remainingInputAmount: "0" })!;
    expect(expiredEmpty.canWithdraw).toBe(false);
    const cancelled = normalizePriceOrder({ ...PRICE_DOC, rawState: "cancelled" })!;
    expect(cancelled.inputAmountRemaining).toBe("0");
  });

  it("falls back to orderState, then to unknown without crashing", () => {
    const viaDisplay = normalizePriceOrder({ ...PRICE_DOC, rawState: "brand_new_state", orderState: "pending_withdraw" })!;
    expect(viaDisplay.status).toBe("needs_withdraw");
    expect(viaDisplay.canWithdraw).toBe(true);
    expect(viaDisplay.state).toBe("brand_new_state");

    const unknown = normalizePriceOrder({ ...PRICE_DOC, rawState: "zzz", orderState: "yyy" })!;
    expect(unknown.status).toBe("unknown");
    expect(unknown.canCancel).toBe(false);
    expect(unknown.canWithdraw).toBe(true); // funds remain
    const unknownEmpty = normalizePriceOrder({ ...PRICE_DOC, rawState: "zzz", orderState: undefined, remainingInputAmount: "0" })!;
    expect(unknownEmpty.canWithdraw).toBe(false);
  });

  it("parses fills and garbage defensively", () => {
    const row = normalizePriceOrder({
      ...PRICE_DOC,
      rawState: "fill_success",
      outputAmount: null,
      fillPercent: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: 1704000000, // seconds by mistake
      expiresAt: null,
      triggerCondition: "sideways",
      initialInputAmount: "1e9",
      events: [
        null,
        { type: "fill", timestamp: 1704000000500, outputAmount: "150", state: "success" },
        { type: "fill", outputAmount: "50", state: "failed" },
        { type: "fill", outputAmount: "25" },
      ],
    })!;
    expect(row.status).toBe("filled");
    expect(row.outputAmountReceived).toBe("175");
    expect(row.createdAt).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(row.updatedAt).toBe(1704000000000);
    expect(row.expiresAt).toBeUndefined();
    expect(row.triggerCondition).toBeUndefined();
    expect(row.inputAmountInitial).toBe("0");
    expect(row.events).toHaveLength(3);
    expect(row.events[2].ts).toBe(0);
    expect(row.fillPercent).toBe(1);
  });

  it("returns null for unusable rows", () => {
    expect(normalizePriceOrder(null)).toBeNull();
    expect(normalizePriceOrder({ id: "x" })).toBeNull();
    expect(normalizePriceOrder({ ...PRICE_DOC, id: 5 })).toBeNull();
  });
});

describe("normalizeDcaOrder", () => {
  it("maps the documented sample", () => {
    const row = normalizeDcaOrder(DCA_DOC)!;
    expect(row).toMatchObject({
      id: DCA_DOC.id,
      family: "dca",
      state: "active",
      status: "open",
      inputMint: USDC,
      outputMint: SOL,
      inputAmountInitial: "20000000",
      inputAmountRemaining: "10000000",
      outputAmountReceived: "137589159",
      orderCount: 2,
      roundsFilled: 1,
      intervalSeconds: 3600,
      amountPerRound: "10000000",
      fillPercent: 0.5,
      nextFillAt: Date.parse("2026-06-26T19:44:57.469Z"),
      createdAt: Date.parse("2026-06-26T18:42:07.782Z"),
      updatedAt: Date.parse("2026-06-26T18:42:11.469Z"),
      canCancel: true,
      canWithdraw: false,
    });
    expect(row.events[0]).toEqual({
      type: "fill",
      ts: Date.parse("2026-06-26T18:42:11.469Z"),
      txSignature: DCA_DOC.events[0].txSignature,
      amount: "10000000",
      outputAmount: "137589159",
      state: "success",
    });
    expect(row.triggerPriceUsd).toBeUndefined();
  });

  it("maps every documented state", () => {
    const table: [string, string, boolean, boolean][] = [
      ["depositing", "open", false, false],
      ["active", "open", true, false],
      ["executing", "filling", false, false],
      ["withdrawing", "withdrawing", false, true],
      ["completed", "filled", false, false],
      ["cancelled", "cancelled", false, false],
      ["deposit_failed", "failed", false, false],
    ];
    for (const [state, status, canCancel, canWithdraw] of table) {
      const row = normalizeDcaOrder({ ...DCA_DOC, state, displayState: "x" })!;
      expect([row.status, row.canCancel, row.canWithdraw], state).toEqual([status, canCancel, canWithdraw]);
    }
  });

  it("zeroes the not-zeroed remainder after cancel and drops nextFillAt", () => {
    const row = normalizeDcaOrder({ ...DCA_DOC, state: "cancelled", displayState: "cancelled" })!;
    expect(row.inputAmountRemaining).toBe("0");
    expect(row.nextFillAt).toBeUndefined();
  });

  it("falls back to displayState then unknown", () => {
    expect(normalizeDcaOrder({ ...DCA_DOC, state: "new", displayState: "pending_withdraw" })!.status).toBe("withdrawing");
    const unknown = normalizeDcaOrder({ ...DCA_DOC, state: "new", displayState: "new" })!;
    expect(unknown.status).toBe("unknown");
    expect(unknown.canWithdraw).toBe(true);
  });
});

describe("page helpers", () => {
  it("parseHistoryPage skips bad rows and tolerates missing pagination", () => {
    const page = parseHistoryPage("price", { orders: [PRICE_DOC, { junk: true }], pagination: { total: 50, limit: 20, offset: 0 } });
    expect(page.rows).toHaveLength(1);
    expect(page.pagination).toEqual({ total: 50, limit: 20, offset: 0 });
    expect(parseHistoryPage("dca", null)).toEqual({ rows: [], pagination: { total: 0, limit: 0, offset: 0 } });
    expect(parseHistoryPage("dca", { orders: [DCA_DOC] }).pagination.total).toBe(1);
  });

  it("selectNeedsWithdraw dedupes; countActiveDca counts withdrawing", () => {
    const expired = normalizePriceOrder({ ...PRICE_DOC, rawState: "expired" })!;
    const open = normalizePriceOrder(PRICE_DOC)!;
    const dcaWithdrawing = normalizeDcaOrder({ ...DCA_DOC, state: "withdrawing" })!;
    const dcaActive = normalizeDcaOrder(DCA_DOC)!;
    const dcaDone = normalizeDcaOrder({ ...DCA_DOC, id: "2", state: "completed" })!;
    expect(selectNeedsWithdraw([expired, open, dcaWithdrawing, expired]).map((r) => r.family)).toEqual([
      "price",
      "dca",
    ]);
    expect(countActiveDca([dcaWithdrawing, dcaActive, dcaDone, open])).toBe(2);
  });
});
