// Pure validation for the Trigger v2 proxy (src/app/api/jupiter/trigger).
// Strict allow-list: a request is forwarded only if its method + path match a
// known route, its ids are UUIDs, and its body/query pass these validators.
// Validators return ONLY the known fields, so nothing else reaches Jupiter.
// No I/O, no env access: everything here is unit tested.

import { isValidPubkey, parseRawAmount, type ValidationResult } from "../params";
import {
  DCA_MAX_BEGIN_DELAY_MS,
  DCA_MAX_INTERVAL_S,
  DCA_MAX_ORDERS,
  DCA_MIN_INTERVAL_S,
  DCA_MIN_ORDERS,
  PROXY_MAX_EXPIRY_MS,
} from "./config";

export type TriggerMethod = "GET" | "POST" | "PATCH";
export type JsonBody = Record<string, unknown>;
export type BodyValidator = (raw: unknown, nowMs: number) => ValidationResult<JsonBody>;

interface ParamSource {
  get(name: string): string | null;
  getAll(name: string): string[];
}
export type QueryValidator = (params: ParamSource) => ValidationResult<URLSearchParams>;

export interface TriggerRoute {
  /** Stable name for logs/tests, e.g. "orders/price/cancel/:id". */
  name: string;
  method: TriggerMethod;
  /** Upstream path below /trigger/v2 (ids already validated), no leading slash. */
  upstreamPath: string;
  /** Requires and forwards the caller's Bearer access token. */
  auth: boolean;
  body: BodyValidator | null;
  query: QueryValidator | null;
  timeoutMs: number;
  /**
   * The upstream call lands a transaction (create order lands the deposit,
   * confirm-cancel lands the withdrawal): a 5xx or timeout leaves the outcome
   * unknown and the client must not blindly retry.
   */
  landsTransaction: boolean;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_RE = /^[a-z0-9-]{1,64}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** Refresh tokens are opaque ("<uuid>.<base64url>"); allow URL-safe base64 + dots. */
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,2048}$/;
const BEARER_RE = /^Bearer ([A-Za-z0-9._~+/=-]{16,4096})$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A signed Solana tx is <= 1232 bytes (~1644 base64 chars); allow headroom. */
export const MAX_SIGNED_TX_B64 = 4096;
/** Upper bound for a USD trigger price (sanity, not a market rule). */
const MAX_PRICE_USD = 1e12;

const SHORT_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 15_000;
const CRAFT_TIMEOUT_MS = 20_000;
/** Create and confirm-cancel wait for the transaction to land. */
const LANDING_TIMEOUT_MS = 45_000;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function base58ByteLength(value: string): number {
  const bytes: number[] = [];
  for (const char of value) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;
  return bytes.length + zeros;
}

/** Base58 string of a 64-byte ed25519 signature. */
export function isBase58Signature(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 64 &&
    v.length <= 88 &&
    base58ByteLength(v) === 64
  );
}

/** Base64 string (std alphabet, padded) of a serialized transaction. */
export function isSignedTxBase64(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_SIGNED_TX_B64 &&
    v.length % 4 === 0 &&
    BASE64_RE.test(v)
  );
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isOpaqueToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Extracts the token from "Authorization: Bearer <token>", or null. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = BEARER_RE.exec(header.trim());
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Body validators

export function validateChallengeBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  const { walletPubkey, type } = raw;
  if (!isValidPubkey(walletPubkey)) return fail("Invalid walletPubkey");
  if (type !== "message" && type !== "transaction") return fail("Invalid challenge type");
  return { ok: true, value: { walletPubkey, type } };
}

export function validateVerifyBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  const { type, walletPubkey, signature, signedTransaction, authMode } = raw;
  if (!isValidPubkey(walletPubkey)) return fail("Invalid walletPubkey");
  // Only the refresh-token model: access_only is deprecated (24h, no revoke).
  if (authMode !== undefined && authMode !== "access_refresh") {
    return fail("authMode must be access_refresh");
  }
  if (type === "message") {
    if (!isBase58Signature(signature)) return fail("Invalid signature");
    return {
      ok: true,
      value: { type, walletPubkey, signature, authMode: "access_refresh" },
    };
  }
  if (type === "transaction") {
    if (!isSignedTxBase64(signedTransaction)) return fail("Invalid signedTransaction");
    return {
      ok: true,
      value: { type, walletPubkey, signedTransaction, authMode: "access_refresh" },
    };
  }
  return fail("Invalid challenge type");
}

export function validateRefreshTokenBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  if (!isOpaqueToken(raw.refreshToken)) return fail("Invalid refreshToken");
  return { ok: true, value: { refreshToken: raw.refreshToken } };
}

export function validateCraftBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  const { inputMint, outputMint, userAddress, amount, orderType, orderSubType } = raw;
  if (!isValidPubkey(inputMint)) return fail("Invalid inputMint");
  if (!isValidPubkey(outputMint)) return fail("Invalid outputMint");
  if (inputMint === outputMint) return fail("inputMint and outputMint must differ");
  if (!isValidPubkey(userAddress)) return fail("Invalid userAddress");
  const rawAmount = parseRawAmount(amount);
  if (!rawAmount) return fail("Invalid amount");
  if (orderType === "price") {
    // Only standalone limit orders are supported (OCO/OTOCO are deferred).
    if (orderSubType !== "single") return fail("orderSubType must be single");
    return {
      ok: true,
      value: { inputMint, outputMint, userAddress, amount: rawAmount, orderType, orderSubType },
    };
  }
  if (orderType === "dca") {
    if (orderSubType !== undefined) return fail("orderSubType must be omitted for dca");
    return { ok: true, value: { inputMint, outputMint, userAddress, amount: rawAmount, orderType } };
  }
  return fail("Invalid orderType");
}

/** Fields shared by both create calls: the signed deposit and the pair. */
function validateDepositFields(
  raw: Record<string, unknown>
): ValidationResult<JsonBody> {
  const { depositRequestId, depositSignedTx, userPubkey, inputMint, outputMint, inputAmount } = raw;
  if (!isUuid(depositRequestId)) return fail("Invalid depositRequestId");
  if (!isSignedTxBase64(depositSignedTx)) return fail("Invalid depositSignedTx");
  if (!isValidPubkey(userPubkey)) return fail("Invalid userPubkey");
  if (!isValidPubkey(inputMint)) return fail("Invalid inputMint");
  if (!isValidPubkey(outputMint)) return fail("Invalid outputMint");
  if (inputMint === outputMint) return fail("inputMint and outputMint must differ");
  const amount = parseRawAmount(inputAmount);
  if (!amount) return fail("Invalid inputAmount");
  return {
    ok: true,
    value: { depositRequestId, depositSignedTx, userPubkey, inputMint, inputAmount: amount, outputMint },
  };
}

export function validateCreatePriceBody(raw: unknown, nowMs: number): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  if (raw.orderType !== "single") return fail("orderType must be single");
  const common = validateDepositFields(raw);
  if (!common.ok) return common;
  const { triggerMint, triggerCondition, triggerPriceUsd, slippageBps, expiresAt } = raw;
  const { inputMint, outputMint } = common.value;
  if (!isValidPubkey(triggerMint) || (triggerMint !== inputMint && triggerMint !== outputMint)) {
    return fail("Invalid triggerMint");
  }
  if (triggerCondition !== "above" && triggerCondition !== "below") {
    return fail("Invalid triggerCondition");
  }
  if (
    typeof triggerPriceUsd !== "number" ||
    !Number.isFinite(triggerPriceUsd) ||
    triggerPriceUsd <= 0 ||
    triggerPriceUsd > MAX_PRICE_USD
  ) {
    return fail("Invalid triggerPriceUsd");
  }
  if (!isIntInRange(expiresAt, nowMs + 1, nowMs + PROXY_MAX_EXPIRY_MS)) {
    return fail("expiresAt must be in the future and at most 31 days out");
  }
  const value: JsonBody = {
    orderType: "single",
    ...common.value,
    triggerMint,
    triggerCondition,
    triggerPriceUsd,
    expiresAt,
  };
  if (slippageBps !== undefined) {
    if (!isIntInRange(slippageBps, 0, 10_000)) return fail("Invalid slippageBps");
    value.slippageBps = slippageBps;
  }
  return { ok: true, value };
}

export function validateCreateDcaBody(raw: unknown, nowMs: number): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  // Only time-based DCA is supported (price_conditional / jlEnabled deferred).
  if (raw.orderType !== undefined && raw.orderType !== "time_based") {
    return fail("orderType must be time_based");
  }
  const common = validateDepositFields(raw);
  if (!common.ok) return common;
  const { orderCount, intervalSeconds, beginFillAt } = raw;
  if (!isIntInRange(orderCount, DCA_MIN_ORDERS, DCA_MAX_ORDERS)) {
    return fail(`orderCount must be an integer from ${DCA_MIN_ORDERS} to ${DCA_MAX_ORDERS}`);
  }
  if (!isIntInRange(intervalSeconds, DCA_MIN_INTERVAL_S, DCA_MAX_INTERVAL_S)) {
    return fail(
      `intervalSeconds must be an integer from ${DCA_MIN_INTERVAL_S} to ${DCA_MAX_INTERVAL_S}`
    );
  }
  const value: JsonBody = {
    orderType: "time_based",
    ...common.value,
    orderCount,
    intervalSeconds,
  };
  if (beginFillAt !== undefined) {
    const ms = typeof beginFillAt === "string" && beginFillAt.length <= 40 ? Date.parse(beginFillAt) : NaN;
    // A minute of slack for clock skew on the upper bound only.
    if (!Number.isFinite(ms) || ms <= nowMs || ms > nowMs + DCA_MAX_BEGIN_DELAY_MS + 60_000) {
      return fail("beginFillAt must be a future ISO time at most 30 days out");
    }
    value.beginFillAt = new Date(ms).toISOString();
  }
  return { ok: true, value };
}

export function validateConfirmCancelBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  const { signedTransaction, cancelRequestId } = raw;
  if (!isSignedTxBase64(signedTransaction)) return fail("Invalid signedTransaction");
  if (!isUuid(cancelRequestId)) return fail("Invalid cancelRequestId");
  return { ok: true, value: { signedTransaction, cancelRequestId } };
}

export function validatePatchPriceBody(raw: unknown): ValidationResult<JsonBody> {
  if (!isPlainObject(raw)) return fail("Invalid request body");
  const { orderType, triggerPriceUsd, slippageBps } = raw;
  if (orderType !== "single") return fail("orderType must be single");
  const value: JsonBody = { orderType };
  if (triggerPriceUsd !== undefined) {
    if (
      typeof triggerPriceUsd !== "number" ||
      !Number.isFinite(triggerPriceUsd) ||
      triggerPriceUsd <= 0 ||
      triggerPriceUsd > MAX_PRICE_USD
    ) {
      return fail("Invalid triggerPriceUsd");
    }
    value.triggerPriceUsd = triggerPriceUsd;
  }
  if (slippageBps !== undefined) {
    if (!isIntInRange(slippageBps, 0, 10_000)) return fail("Invalid slippageBps");
    value.slippageBps = slippageBps;
  }
  if (Object.keys(value).length === 1) return fail("Nothing to update");
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Query validators (history)

function historyQueryValidator(sorts: readonly string[]): QueryValidator {
  return (params) => {
    const out = new URLSearchParams();
    const single = (name: string): string | null | false => {
      const all = params.getAll(name);
      if (all.length > 1) return false;
      return all.length === 1 ? all[0] : null;
    };
    const state = single("state");
    const mint = single("mint");
    const limit = single("limit");
    const offset = single("offset");
    const sort = single("sort");
    const dir = single("dir");
    if (
      state === false ||
      mint === false ||
      limit === false ||
      offset === false ||
      sort === false ||
      dir === false
    ) {
      return fail("Duplicate query parameter");
    }
    if (state !== null) {
      if (state !== "active" && state !== "past") return fail("Invalid state");
      out.set("state", state);
    }
    if (mint !== null) {
      if (!isValidPubkey(mint)) return fail("Invalid mint");
      out.set("mint", mint);
    }
    if (limit !== null) {
      if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
        return fail("limit must be 1-100");
      }
      out.set("limit", String(Number(limit)));
    }
    if (offset !== null) {
      if (!/^\d{1,6}$/.test(offset)) return fail("Invalid offset");
      out.set("offset", String(Number(offset)));
    }
    if (sort !== null) {
      if (!sorts.includes(sort)) return fail("Invalid sort");
      out.set("sort", sort);
    }
    if (dir !== null) {
      if (dir !== "asc" && dir !== "desc") return fail("Invalid dir");
      out.set("dir", dir);
    }
    return { ok: true, value: out };
  };
}

export const validatePriceHistoryQuery = historyQueryValidator([
  "updated_at",
  "created_at",
  "expires_at",
]);
export const validateDcaHistoryQuery = historyQueryValidator([
  "updated_at",
  "created_at",
  "next_fill_at",
]);

// ---------------------------------------------------------------------------
// Route table

const route = (
  name: string,
  method: TriggerMethod,
  upstreamPath: string,
  opts: Partial<Omit<TriggerRoute, "name" | "method" | "upstreamPath">> = {}
): TriggerRoute => ({
  name,
  method,
  upstreamPath,
  auth: opts.auth ?? true,
  body: opts.body ?? null,
  query: opts.query ?? null,
  timeoutMs: opts.timeoutMs ?? READ_TIMEOUT_MS,
  landsTransaction: opts.landsTransaction ?? false,
});

/**
 * Resolves method + path segments (below /api/jupiter/trigger/) to an allowed
 * upstream route, or null (the proxy answers 404). Ids must be UUIDs.
 */
export function matchTriggerRoute(method: string, segments: readonly string[]): TriggerRoute | null {
  if (segments.length < 1 || segments.length > 4) return null;
  if (!segments.every((s) => SEGMENT_RE.test(s))) return null;
  const path = segments.join("/");
  const [a, b, c, d] = segments;

  if (method === "POST") {
    switch (path) {
      case "auth/challenge":
        return route(path, "POST", path, { auth: false, body: validateChallengeBody, timeoutMs: SHORT_TIMEOUT_MS });
      case "auth/verify":
        return route(path, "POST", path, { auth: false, body: validateVerifyBody, timeoutMs: SHORT_TIMEOUT_MS });
      case "auth/refresh":
        return route(path, "POST", path, { auth: false, body: validateRefreshTokenBody, timeoutMs: SHORT_TIMEOUT_MS });
      case "auth/logout":
        return route(path, "POST", path, { auth: false, body: validateRefreshTokenBody, timeoutMs: SHORT_TIMEOUT_MS });
      case "deposit/craft":
        return route(path, "POST", path, { body: validateCraftBody, timeoutMs: CRAFT_TIMEOUT_MS });
      case "orders/price":
        return route(path, "POST", path, {
          body: validateCreatePriceBody,
          timeoutMs: LANDING_TIMEOUT_MS,
          landsTransaction: true,
        });
      case "orders/dca":
        return route(path, "POST", path, {
          body: validateCreateDcaBody,
          timeoutMs: LANDING_TIMEOUT_MS,
          landsTransaction: true,
        });
    }
    if (segments.length === 4 && a === "orders" && (b === "price" || b === "dca") && isUuid(d)) {
      if (c === "cancel") {
        return route(`orders/${b}/cancel/:id`, "POST", path, { timeoutMs: CRAFT_TIMEOUT_MS });
      }
      if (c === "confirm-cancel") {
        return route(`orders/${b}/confirm-cancel/:id`, "POST", path, {
          body: validateConfirmCancelBody,
          timeoutMs: LANDING_TIMEOUT_MS,
          landsTransaction: true,
        });
      }
    }
    return null;
  }

  if (method === "GET") {
    switch (path) {
      case "vault":
      case "vault/register":
        return route(path, "GET", path);
      case "orders/history":
        return route(path, "GET", path, { query: validatePriceHistoryQuery });
      case "orders/history/dca":
        return route(path, "GET", path, { query: validateDcaHistoryQuery });
    }
    if (segments.length === 4 && a === "orders" && b === "history" && c === "dca" && isUuid(d)) {
      return route("orders/history/dca/:id", "GET", path);
    }
    return null;
  }

  if (method === "PATCH") {
    if (segments.length === 3 && a === "orders" && b === "price" && isUuid(c)) {
      return route("orders/price/:id", "PATCH", path, { body: validatePatchPriceBody });
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Upstream response classification

/**
 * True for Trigger's own JWT rejection ({"error":"Unauthorized"}-style body:
 * an `error` string and no gateway `code`/`message`). The API gateway also
 * answers 401 for a bad x-api-key, with a different shape; refreshing the
 * user's session would not help there.
 */
export function isTriggerAuthRejection(status: number, body: unknown): boolean {
  if (status !== 401 || !isPlainObject(body)) return false;
  return typeof body.error === "string" && !("code" in body) && !("message" in body);
}

/** Copies a validation `details` map, keeping only short primitive values. */
export function sanitizeDetails(details: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isPlainObject(details)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, v] of Object.entries(details)) {
    if (n >= 12) break;
    if (k.length > 64) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else continue;
    n++;
  }
  return n > 0 ? out : undefined;
}
