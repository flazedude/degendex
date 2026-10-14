import { describe, expect, it } from "vitest";
import {
  isBase58Signature,
  isTriggerAuthRejection,
  matchTriggerRoute,
  parseBearer,
  sanitizeDetails,
  validateChallengeBody,
  validateConfirmCancelBody,
  validateCraftBody,
  validateCreateDcaBody,
  validateCreatePriceBody,
  validateDcaHistoryQuery,
  validatePatchPriceBody,
  validatePriceHistoryQuery,
  validateRefreshTokenBody,
  validateVerifyBody,
} from "./params";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const UUID = "019f0530-36a7-77da-a38f-ed9414bb996b";
const UUID2 = "368645e8-7ac6-4c88-8b10-3a68812bdc1d";
const SIG = "PPbp1QbbKDPjpHM3ScKyZBnCtLKKqmWwDeVj7USdBeEoNQsA1hkN35UQfrY2cQpyAB1pfVi9FdfciYdz7qUXBQA";
const TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAEN";
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("matchTriggerRoute", () => {
  it("maps every allowed method + path", () => {
    const cases: [string, string, string][] = [
      ["POST", "auth/challenge", "auth/challenge"],
      ["POST", "auth/verify", "auth/verify"],
      ["POST", "auth/refresh", "auth/refresh"],
      ["POST", "auth/logout", "auth/logout"],
      ["GET", "vault", "vault"],
      ["GET", "vault/register", "vault/register"],
      ["GET", "orders/history", "orders/history"],
      ["GET", "orders/history/dca", "orders/history/dca"],
      ["GET", `orders/history/dca/${UUID}`, "orders/history/dca/:id"],
      ["POST", "deposit/craft", "deposit/craft"],
      ["POST", "orders/price", "orders/price"],
      ["POST", "orders/dca", "orders/dca"],
      ["POST", `orders/price/cancel/${UUID}`, "orders/price/cancel/:id"],
      ["POST", `orders/price/confirm-cancel/${UUID}`, "orders/price/confirm-cancel/:id"],
      ["POST", `orders/dca/cancel/${UUID}`, "orders/dca/cancel/:id"],
      ["POST", `orders/dca/confirm-cancel/${UUID}`, "orders/dca/confirm-cancel/:id"],
      ["PATCH", `orders/price/${UUID}`, "orders/price/:id"],
    ];
    for (const [method, path, name] of cases) {
      const r = matchTriggerRoute(method, path.split("/"));
      expect(r, `${method} ${path}`).not.toBeNull();
      expect(r!.name).toBe(name);
      expect(r!.upstreamPath).toBe(path);
    }
  });

  it("marks auth routes as unauthenticated and landing routes as such", () => {
    expect(matchTriggerRoute("POST", ["auth", "challenge"])!.auth).toBe(false);
    expect(matchTriggerRoute("POST", ["auth", "refresh"])!.auth).toBe(false);
    expect(matchTriggerRoute("GET", ["vault"])!.auth).toBe(true);
    expect(matchTriggerRoute("POST", ["orders", "price"])!.landsTransaction).toBe(true);
    expect(matchTriggerRoute("POST", ["orders", "dca", "confirm-cancel", UUID])!.landsTransaction).toBe(true);
    expect(matchTriggerRoute("POST", ["orders", "dca", "cancel", UUID])!.landsTransaction).toBe(false);
    expect(matchTriggerRoute("POST", ["orders", "price"])!.timeoutMs).toBe(45_000);
  });

  it("rejects everything else", () => {
    const bad: [string, string[]][] = [
      ["GET", ["auth", "challenge"]],
      ["POST", ["vault"]],
      ["DELETE", ["vault"]],
      ["POST", ["auth", "logout-all"]],
      ["PATCH", ["orders", "dca", UUID]],
      ["POST", ["orders", "price", "cancel", "not-a-uuid"]],
      ["POST", ["orders", "price", "cancel", `${UUID}x`]],
      ["GET", ["orders", "history", "dca", "../vault"]],
      ["GET", ["orders", "history", "price"]],
      ["GET", []],
      ["GET", ["vault", ""]],
      ["POST", ["orders", "dca", ""]],
      ["GET", ["..", "swap", "v2", "order"]],
      ["POST", ["orders", "price", "cancel", UUID, "extra"]],
    ];
    for (const [m, segs] of bad) expect(matchTriggerRoute(m, segs), `${m} ${segs.join("/")}`).toBeNull();
  });
});

describe("auth body validators", () => {
  it("challenge", () => {
    expect(validateChallengeBody({ walletPubkey: WALLET, type: "message", extra: 1 })).toEqual({
      ok: true,
      value: { walletPubkey: WALLET, type: "message" },
    });
    expect(validateChallengeBody({ walletPubkey: WALLET, type: "sms" }).ok).toBe(false);
    expect(validateChallengeBody({ walletPubkey: "nope", type: "message" }).ok).toBe(false);
    expect(validateChallengeBody([]).ok).toBe(false);
  });

  it("verify: message and transaction, authMode forced to access_refresh", () => {
    expect(validateVerifyBody({ type: "message", walletPubkey: WALLET, signature: SIG })).toEqual({
      ok: true,
      value: { type: "message", walletPubkey: WALLET, signature: SIG, authMode: "access_refresh" },
    });
    expect(
      validateVerifyBody({
        type: "transaction",
        walletPubkey: WALLET,
        signedTransaction: TX,
        authMode: "access_refresh",
        signature: SIG,
      })
    ).toEqual({
      ok: true,
      value: { type: "transaction", walletPubkey: WALLET, signedTransaction: TX, authMode: "access_refresh" },
    });
    expect(validateVerifyBody({ type: "message", walletPubkey: WALLET, signature: SIG, authMode: "access_only" }).ok).toBe(false);
    expect(validateVerifyBody({ type: "message", walletPubkey: WALLET, signature: "abc" }).ok).toBe(false);
    expect(validateVerifyBody({ type: "transaction", walletPubkey: WALLET, signedTransaction: "!!!!" }).ok).toBe(false);
    expect(validateVerifyBody({ type: "transaction", walletPubkey: WALLET, signedTransaction: "A".repeat(4100) }).ok).toBe(false);
  });

  it("base58 signature must decode to 64 bytes", () => {
    expect(isBase58Signature(SIG)).toBe(true);
    expect(isBase58Signature(WALLET)).toBe(false);
    expect(isBase58Signature(`${SIG}0`)).toBe(false);
  });

  it("refresh / logout token", () => {
    const rt = "01a08512-95d8-70ac-bab5-20c73aa002bb.6lr8kn3eMIsNGR9rXR1_-x";
    expect(validateRefreshTokenBody({ refreshToken: rt, authMode: "x" })).toEqual({ ok: true, value: { refreshToken: rt } });
    expect(validateRefreshTokenBody({ refreshToken: "short" }).ok).toBe(false);
    expect(validateRefreshTokenBody({ refreshToken: "bad token with spaces!!" }).ok).toBe(false);
    expect(validateRefreshTokenBody({}).ok).toBe(false);
  });
});

describe("validateCraftBody", () => {
  const base = { inputMint: SOL, outputMint: USDC, userAddress: WALLET, amount: "1000000000" };
  it("price requires orderSubType single, dca forbids it", () => {
    expect(validateCraftBody({ ...base, orderType: "price", orderSubType: "single", jlMint: SOL })).toEqual({
      ok: true,
      value: { ...base, orderType: "price", orderSubType: "single" },
    });
    expect(validateCraftBody({ ...base, orderType: "price" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, orderType: "price", orderSubType: "oco" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, orderType: "dca" })).toEqual({ ok: true, value: { ...base, orderType: "dca" } });
    expect(validateCraftBody({ ...base, orderType: "dca", orderSubType: "single" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, orderType: "limit" }).ok).toBe(false);
  });
  it("validates mints and amounts", () => {
    expect(validateCraftBody({ ...base, outputMint: SOL, orderType: "dca" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, amount: "1.5", orderType: "dca" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, amount: "0", orderType: "dca" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, amount: "18446744073709551616", orderType: "dca" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, amount: 5, orderType: "dca" }).ok).toBe(false);
    expect(validateCraftBody({ ...base, userAddress: "x", orderType: "dca" }).ok).toBe(false);
  });
});

describe("validateCreatePriceBody", () => {
  const body = {
    orderType: "single",
    depositRequestId: UUID,
    depositSignedTx: TX,
    userPubkey: WALLET,
    inputMint: USDC,
    inputAmount: "20000000",
    outputMint: SOL,
    triggerMint: SOL,
    triggerCondition: "below",
    triggerPriceUsd: 150.5,
    expiresAt: NOW + 7 * DAY,
  };
  it("accepts a valid single order and forwards only known fields", () => {
    const r = validateCreatePriceBody({ ...body, trailingBps: 100, junk: true }, NOW);
    expect(r).toEqual({ ok: true, value: body });
    const withSlip = validateCreatePriceBody({ ...body, slippageBps: 100 }, NOW);
    expect(withSlip.ok && withSlip.value.slippageBps).toBe(100);
  });
  it("rejects bad fields", () => {
    const bad: Record<string, unknown>[] = [
      { orderType: "oco" },
      { depositRequestId: "nope" },
      { depositSignedTx: "" },
      { userPubkey: "x" },
      { triggerMint: USDC.replace("E", "F") },
      { triggerMint: "So11111111111111111111111111111111111111111" },
      { triggerCondition: "equal" },
      { triggerPriceUsd: 0 },
      { triggerPriceUsd: -1 },
      { triggerPriceUsd: "150" },
      { triggerPriceUsd: Number.NaN },
      { triggerPriceUsd: Infinity },
      { slippageBps: 10_001 },
      { slippageBps: 1.5 },
      { expiresAt: NOW - 1 },
      { expiresAt: NOW + 32 * DAY },
      { expiresAt: NOW + 1.5 },
      { inputAmount: "-1" },
      { outputMint: USDC },
    ];
    for (const patch of bad) {
      expect(validateCreatePriceBody({ ...body, ...patch }, NOW).ok, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("validateCreateDcaBody", () => {
  const body = {
    depositRequestId: UUID,
    depositSignedTx: TX,
    userPubkey: WALLET,
    inputMint: USDC,
    inputAmount: "20000000",
    outputMint: SOL,
    orderCount: 2,
    intervalSeconds: 3600,
  };
  it("accepts and normalises", () => {
    expect(validateCreateDcaBody(body, NOW)).toEqual({ ok: true, value: { orderType: "time_based", ...body } });
    const begin = new Date(NOW + DAY).toISOString();
    const r = validateCreateDcaBody({ ...body, orderType: "time_based", beginFillAt: begin, jlEnabled: true }, NOW);
    expect(r).toEqual({ ok: true, value: { orderType: "time_based", ...body, beginFillAt: begin } });
  });
  it("rejects out-of-range values", () => {
    const bad: Record<string, unknown>[] = [
      { orderType: "price_conditional" },
      { orderCount: 1 },
      { orderCount: 2.5 },
      { orderCount: 10_001 },
      { intervalSeconds: 59 },
      { intervalSeconds: 31_536_001 },
      { beginFillAt: new Date(NOW - 1000).toISOString() },
      { beginFillAt: new Date(NOW + 31 * DAY).toISOString() },
      { beginFillAt: "tomorrow" },
      { beginFillAt: NOW + DAY },
    ];
    for (const patch of bad) {
      expect(validateCreateDcaBody({ ...body, ...patch }, NOW).ok, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("confirm-cancel and patch", () => {
  it("confirm-cancel", () => {
    expect(validateConfirmCancelBody({ signedTransaction: TX, cancelRequestId: UUID2, x: 1 })).toEqual({
      ok: true,
      value: { signedTransaction: TX, cancelRequestId: UUID2 },
    });
    expect(validateConfirmCancelBody({ signedTransaction: TX, cancelRequestId: "cancel-request-uuid" }).ok).toBe(false);
    expect(validateConfirmCancelBody({ signedTransaction: "%%", cancelRequestId: UUID2 }).ok).toBe(false);
  });
  it("patch", () => {
    expect(validatePatchPriceBody({ orderType: "single", triggerPriceUsd: 210, trailingBps: 50 })).toEqual({
      ok: true,
      value: { orderType: "single", triggerPriceUsd: 210 },
    });
    expect(validatePatchPriceBody({ orderType: "single" }).ok).toBe(false);
    expect(validatePatchPriceBody({ orderType: "oco", tpPriceUsd: 1 }).ok).toBe(false);
    expect(validatePatchPriceBody({ orderType: "single", slippageBps: -1 }).ok).toBe(false);
  });
});

describe("history query validators", () => {
  it("allow-lists params", () => {
    const r = validatePriceHistoryQuery(
      new URLSearchParams(`state=active&mint=${SOL}&limit=50&offset=20&sort=expires_at&dir=asc&evil=1`)
    );
    expect(r.ok && Object.fromEntries(r.value)).toEqual({
      state: "active",
      mint: SOL,
      limit: "50",
      offset: "20",
      sort: "expires_at",
      dir: "asc",
    });
    const dca = validateDcaHistoryQuery(new URLSearchParams("sort=next_fill_at"));
    expect(dca.ok && dca.value.toString()).toBe("sort=next_fill_at");
  });
  it("rejects bad values and duplicates", () => {
    for (const q of [
      "state=open",
      "mint=abc",
      "limit=0",
      "limit=101",
      "limit=1e2",
      "offset=-1",
      "sort=price",
      "dir=up",
      "state=active&state=past",
    ]) {
      expect(validatePriceHistoryQuery(new URLSearchParams(q)).ok, q).toBe(false);
    }
    expect(validatePriceHistoryQuery(new URLSearchParams("sort=next_fill_at")).ok).toBe(false);
    expect(validateDcaHistoryQuery(new URLSearchParams("sort=expires_at")).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("parseBearer", () => {
    expect(parseBearer("Bearer eyJhbGciOiJIUzI1NiIs.payload.sig")).toBe("eyJhbGciOiJIUzI1NiIs.payload.sig");
    expect(parseBearer("bearer eyJhbGciOiJIUzI1NiIs.payload.sig")).toBeNull();
    expect(parseBearer("Bearer short")).toBeNull();
    expect(parseBearer("Bearer abc\r\nX-Evil: 1aaaaaaaaaaaaaaa")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
  it("isTriggerAuthRejection distinguishes Trigger from the gateway", () => {
    expect(isTriggerAuthRejection(401, { error: "Unauthorized" })).toBe(true);
    expect(isTriggerAuthRejection(401, { code: 401, message: "Invalid API key" })).toBe(false);
    expect(isTriggerAuthRejection(401, null)).toBe(false);
    expect(isTriggerAuthRejection(403, { error: "Unauthorized" })).toBe(false);
  });
  it("sanitizeDetails keeps short primitives only", () => {
    expect(sanitizeDetails({ a: "x".repeat(300), b: 1, c: { nested: true }, d: null })).toEqual({
      a: "x".repeat(200),
      b: 1,
      d: null,
    });
    expect(sanitizeDetails("nope")).toBeUndefined();
    expect(sanitizeDetails({})).toBeUndefined();
  });
});
