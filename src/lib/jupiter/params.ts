// Pure validation helpers shared by the Jupiter proxy routes and the client.
// No I/O, no env access: everything here is unit tested.

export const U64_MAX = BigInt("18446744073709551615");

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Number of bytes a base58 string decodes to, or -1 if it is not base58. */
function base58DecodedLength(value: string): number {
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
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === "1") {
    leadingZeros++;
  }
  return bytes.length + leadingZeros;
}

/** True for a base58 string that decodes to exactly 32 bytes (a Solana pubkey). */
export function isValidPubkey(value: unknown): value is string {
  if (typeof value !== "string" || !BASE58_RE.test(value)) return false;
  return base58DecodedLength(value) === 32;
}

/**
 * Parses a raw token amount (smallest units). Accepts only plain digit strings
 * (no sign, no decimals, no exponent) in 1..u64::MAX. Returns the normalized
 * string or null.
 */
export function parseRawAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return null;
  const n = BigInt(value);
  if (n <= BigInt(0) || n > U64_MAX) return null;
  return n.toString();
}

/** Parses slippage in bps: an integer 0..10000 as a plain digit string. */
export function parseSlippageBps(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n >= 0 && n <= 10_000 ? n : null;
}

export interface OrderParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface ParamSource {
  get(name: string): string | null;
  getAll(name: string): string[];
}

function single(params: ParamSource, name: string): string | null | false {
  const all = params.getAll(name);
  if (all.length > 1) return false;
  return all.length === 1 ? all[0] : null;
}

/** Validates and allowlists the query params of GET /api/jupiter/order. */
export function validateOrderParams(
  params: ParamSource
): ValidationResult<OrderParams> {
  const inputMint = single(params, "inputMint");
  const outputMint = single(params, "outputMint");
  const amount = single(params, "amount");
  const taker = single(params, "taker");
  const slippage = single(params, "slippageBps");

  if (
    inputMint === false ||
    outputMint === false ||
    amount === false ||
    taker === false ||
    slippage === false
  ) {
    return { ok: false, error: "Duplicate query parameter" };
  }
  if (!isValidPubkey(inputMint)) return { ok: false, error: "Invalid inputMint" };
  if (!isValidPubkey(outputMint)) {
    return { ok: false, error: "Invalid outputMint" };
  }
  if (inputMint === outputMint) {
    return { ok: false, error: "inputMint and outputMint must differ" };
  }
  const rawAmount = parseRawAmount(amount);
  if (!rawAmount) return { ok: false, error: "Invalid amount" };

  const value: OrderParams = { inputMint, outputMint, amount: rawAmount };

  if (taker !== null && taker !== "") {
    if (!isValidPubkey(taker)) return { ok: false, error: "Invalid taker" };
    value.taker = taker;
  }
  if (slippage !== null && slippage !== "") {
    const bps = parseSlippageBps(slippage);
    if (bps === null) return { ok: false, error: "Invalid slippageBps" };
    value.slippageBps = bps;
  }
  return { ok: true, value };
}

export interface ReferralConfig {
  referralAccount: string;
  referralFee: number;
}

/**
 * Parses referral env config. Both values must be set, the account must be a
 * valid pubkey and the fee an integer in 50..255 bps (Jupiter's allowed range).
 */
export function parseReferralConfig(
  account: string | undefined,
  feeBps: string | undefined
): { config: ReferralConfig | null; warning?: string } {
  const acc = account?.trim() ?? "";
  const fee = feeBps?.trim() ?? "";
  if (!acc && !fee) return { config: null };
  if (!acc || !fee) {
    return {
      config: null,
      warning:
        "JUPITER_REFERRAL_ACCOUNT and JUPITER_REFERRAL_FEE_BPS must both be set; referral fees disabled",
    };
  }
  if (!isValidPubkey(acc)) {
    return {
      config: null,
      warning: "JUPITER_REFERRAL_ACCOUNT is not a valid pubkey; referral fees disabled",
    };
  }
  if (!/^\d{1,3}$/.test(fee) || Number(fee) < 50 || Number(fee) > 255) {
    return {
      config: null,
      warning:
        "JUPITER_REFERRAL_FEE_BPS must be an integer between 50 and 255; referral fees disabled",
    };
  }
  return { config: { referralAccount: acc, referralFee: Number(fee) } };
}

/** Builds the upstream query string from validated params only. */
export function buildOrderQuery(
  params: OrderParams,
  referral: ReferralConfig | null
): URLSearchParams {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  if (params.taker) qs.set("taker", params.taker);
  if (params.slippageBps !== undefined) {
    qs.set("slippageBps", String(params.slippageBps));
  }
  if (referral) {
    qs.set("referralAccount", referral.referralAccount);
    qs.set("referralFee", String(referral.referralFee));
  }
  return qs;
}

export interface ExecuteBody {
  signedTransaction: string;
  requestId: string;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,128}$/;

/** Validates the JSON body of POST /api/jupiter/execute. */
export function validateExecuteBody(
  body: unknown
): ValidationResult<ExecuteBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const { signedTransaction, requestId } = body as Record<string, unknown>;
  if (
    typeof signedTransaction !== "string" ||
    signedTransaction.length === 0 ||
    signedTransaction.length > 4096 ||
    signedTransaction.length % 4 !== 0 ||
    !BASE64_RE.test(signedTransaction)
  ) {
    return { ok: false, error: "Invalid signedTransaction" };
  }
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    return { ok: false, error: "Invalid requestId" };
  }
  return { ok: true, value: { signedTransaction, requestId } };
}

/** Validates ?query= of GET /api/jupiter/tokens. */
export function validateTokenQuery(
  query: string | null | undefined
): ValidationResult<string> {
  const q = (query ?? "").trim();
  if (q.length < 1 || q.length > 2000) {
    return { ok: false, error: "query must be 1-2000 characters" };
  }
  return { ok: true, value: q };
}

export type SlippageSetting = "auto" | number;

/** Custom slippage bounds offered in the UI: 0.01% .. 50%. */
export const MIN_CUSTOM_SLIPPAGE_BPS = 1;
export const MAX_CUSTOM_SLIPPAGE_BPS = 5000;

/** Coerces any (possibly persisted, possibly garbage) value to a valid setting. */
export function normalizeSlippageSetting(value: unknown): SlippageSetting {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CUSTOM_SLIPPAGE_BPS &&
    value <= MAX_CUSTOM_SLIPPAGE_BPS
  ) {
    return value;
  }
  return "auto";
}
