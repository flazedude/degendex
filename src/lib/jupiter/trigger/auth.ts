// Wallet sign-in for Trigger v2: challenge -> validate -> sign -> verify.
// Message mode by default; transaction mode (Ledger) when the wallet has no
// signMessage or reports it unsupported. A user rejection never falls back.
// Pure with injected dependencies so it can be unit tested.

import { VersionedTransaction } from "@solana/web3.js";
import { isUserRejection } from "../errors";
import { base64ToBytes, bytesToBase58, bytesToBase64 } from "../encoding";
import { parseAuthTokens } from "./client";
import type { TriggerAuthTokens, TriggerChallengeType } from "./types";
import { validateAuthMessage, validateAuthTransaction } from "./validateTx";

export type SignInErrorKind = "rejected" | "unsupported" | "invalid_challenge" | "failed";

export class TriggerSignInError extends Error {
  readonly kind: SignInErrorKind;
  constructor(kind: SignInErrorKind, message: string) {
    super(message);
    this.name = "TriggerSignInError";
    this.kind = kind;
  }
}

export interface SignInDeps {
  wallet: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  /** Unauthenticated POST to the proxy (auth/challenge, auth/verify). */
  post: (path: "auth/challenge" | "auth/verify", body: Record<string, unknown>) => Promise<unknown>;
  now?: () => number;
}

export interface SignInResult {
  tokens: TriggerAuthTokens;
  mode: TriggerChallengeType;
}

/** Wallet errors meaning "this wallet cannot sign messages" (e.g. Ledger). */
export function isSignMessageUnsupported(err: unknown): boolean {
  if (isUserRejection(err)) return false;
  const e = err as { message?: unknown; name?: unknown; error?: { message?: unknown } } | null;
  const text = [e?.message, e?.error?.message, e?.name]
    .filter((m): m is string => typeof m === "string")
    .join(" ");
  return /not supported|unsupported|not implemented|not available|does not support|doesn't support|cannot sign message|signMessage is not|method not found|ledger/i.test(
    text
  );
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

async function verify(deps: SignInDeps, body: Record<string, unknown>): Promise<TriggerAuthTokens> {
  const res = await deps.post("auth/verify", { ...body, walletPubkey: deps.wallet, authMode: "access_refresh" });
  const tokens = parseAuthTokens(res, (deps.now ?? Date.now)());
  if (!tokens) throw new TriggerSignInError("failed", "Unexpected sign-in response from Jupiter");
  return tokens;
}

async function viaMessage(deps: SignInDeps): Promise<TriggerAuthTokens> {
  if (!deps.signMessage) throw new TriggerSignInError("unsupported", "This wallet cannot sign messages");
  const ch = await deps.post("auth/challenge", { walletPubkey: deps.wallet, type: "message" });
  const challenge = isObj(ch) ? ch.challenge : undefined;
  const check = validateAuthMessage(challenge, deps.wallet);
  if (!check.ok) throw new TriggerSignInError("invalid_challenge", check.reason);
  const sig = await deps.signMessage(new TextEncoder().encode(challenge as string));
  if (!(sig instanceof Uint8Array) || sig.length !== 64) {
    throw new TriggerSignInError("failed", "Wallet returned an invalid signature");
  }
  return verify(deps, { type: "message", signature: bytesToBase58(sig) });
}

async function viaTransaction(deps: SignInDeps): Promise<TriggerAuthTokens> {
  if (!deps.signTransaction) {
    throw new TriggerSignInError("unsupported", "This wallet cannot sign transactions");
  }
  const ch = await deps.post("auth/challenge", { walletPubkey: deps.wallet, type: "transaction" });
  const b64 = isObj(ch) ? ch.transaction : undefined;
  let tx: VersionedTransaction;
  try {
    if (typeof b64 !== "string") throw new Error("missing");
    tx = VersionedTransaction.deserialize(base64ToBytes(b64));
  } catch {
    throw new TriggerSignInError("invalid_challenge", "Could not decode the sign-in transaction");
  }
  const check = validateAuthTransaction(tx, deps.wallet);
  if (!check.ok) throw new TriggerSignInError("invalid_challenge", check.reason);
  const signed = await deps.signTransaction(tx);
  const idx = signed.message.staticAccountKeys.findIndex((k) => k.toBase58() === deps.wallet);
  const sig = idx >= 0 ? signed.signatures[idx] : undefined;
  if (!sig || sig.every((b) => b === 0)) {
    throw new TriggerSignInError("failed", "Wallet did not sign the sign-in transaction");
  }
  return verify(deps, { type: "transaction", signedTransaction: bytesToBase64(signed.serialize()) });
}

/**
 * Runs the sign-in. `mode` forces a flow; without it, message mode is tried
 * first and transaction mode is the fallback for wallets that cannot sign
 * messages. Throws TriggerSignInError (kind "rejected" on user rejection) or
 * the underlying request error.
 */
export async function signInToTrigger(deps: SignInDeps, mode?: TriggerChallengeType): Promise<SignInResult> {
  try {
    if (mode === "transaction" || (!mode && !deps.signMessage)) {
      return { tokens: await viaTransaction(deps), mode: "transaction" };
    }
    try {
      return { tokens: await viaMessage(deps), mode: "message" };
    } catch (err) {
      const unsupported =
        (err instanceof TriggerSignInError && err.kind === "unsupported") || isSignMessageUnsupported(err);
      if (mode === "message" || !unsupported || !deps.signTransaction) throw err;
      // A new challenge replaces the message one (only the latest is valid).
      return { tokens: await viaTransaction(deps), mode: "transaction" };
    }
  } catch (err) {
    if (isUserRejection(err)) throw new TriggerSignInError("rejected", "Sign-in cancelled in wallet");
    throw err;
  }
}
