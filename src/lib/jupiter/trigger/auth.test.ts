import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { bytesToBase64 } from "../encoding";
import { isSignMessageUnsupported, signInToTrigger, TriggerSignInError } from "./auth";
import { MEMO_PROGRAM_ID } from "./validateTx";

const user = Keypair.generate();
const W = user.publicKey.toBase58();
const jup = Keypair.generate().publicKey;
const MESSAGE = `Sign this message to authenticate with Jupiter that you are the owner of ${W}.\n\nThis challenge expires at 2026-10-14T06:03:09.295Z with the nonce of 01a138fd.`;
const TOKENS = {
  authMode: "access_refresh",
  accessToken: "a",
  refreshToken: "r",
  expiresAt: "2099-01-01T00:00:00.000Z",
  tokenType: "Bearer",
};

function authTx(wallet = user.publicKey, text = `Sign this transaction to authenticate with Jupiter that you are the owner of ${W}.\n\nx`) {
  const msg = new TransactionMessage({
    payerKey: jup,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        keys: [{ pubkey: wallet, isSigner: true, isWritable: false }],
        data: Buffer.from(text),
      }),
    ],
  }).compileToLegacyMessage();
  return bytesToBase64(new VersionedTransaction(msg).serialize());
}

function post(challengeTx = authTx()) {
  return vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path === "auth/challenge") {
      return body.type === "message" ? { type: "message", challenge: MESSAGE } : { type: "transaction", transaction: challengeTx };
    }
    return TOKENS;
  });
}

const signTx = vi.fn(async (tx: VersionedTransaction) => {
  tx.sign([user]);
  return tx;
});

describe("signInToTrigger", () => {
  it("message mode: signs the exact UTF-8 challenge and verifies with base58 + access_refresh", async () => {
    const p = post();
    const signMessage = vi.fn(async (m: Uint8Array) => {
      expect(new TextDecoder().decode(m)).toBe(MESSAGE);
      return new Uint8Array(64).fill(7);
    });
    const r = await signInToTrigger({ wallet: W, signMessage, signTransaction: signTx, post: p });
    expect(r.mode).toBe("message");
    expect(r.tokens.accessToken).toBe("a");
    const verifyBody = p.mock.calls[1][1];
    expect(verifyBody).toMatchObject({ type: "message", walletPubkey: W, authMode: "access_refresh" });
    expect(typeof verifyBody.signature).toBe("string");
  });

  it("falls back to transaction mode when signMessage is missing", async () => {
    const p = post();
    const r = await signInToTrigger({ wallet: W, signTransaction: signTx, post: p });
    expect(r.mode).toBe("transaction");
    expect(p.mock.calls[0][1]).toEqual({ walletPubkey: W, type: "transaction" });
    expect(p.mock.calls[1][1]).toMatchObject({ type: "transaction", authMode: "access_refresh" });
  });

  it("falls back when signMessage is unsupported, but not on rejection", async () => {
    const p = post();
    const unsupported = vi.fn(async () => {
      throw new Error("Ledger does not support signing messages");
    });
    expect((await signInToTrigger({ wallet: W, signMessage: unsupported, signTransaction: signTx, post: p })).mode).toBe(
      "transaction"
    );

    const rejected = vi.fn(async () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    });
    const p2 = post();
    const err = await signInToTrigger({ wallet: W, signMessage: rejected, signTransaction: signTx, post: p2 }).catch((e) => e);
    expect(err).toBeInstanceOf(TriggerSignInError);
    expect(err.kind).toBe("rejected");
    expect(p2.mock.calls.map((c) => c[0])).toEqual(["auth/challenge"]);
  });

  it("explicit message mode does not fall back", async () => {
    const unsupported = vi.fn(async () => {
      throw new Error("Method not supported");
    });
    await expect(
      signInToTrigger({ wallet: W, signMessage: unsupported, signTransaction: signTx, post: post() }, "message")
    ).rejects.toThrow("Method not supported");
  });

  it("refuses a challenge for another wallet before asking the wallet", async () => {
    const other = Keypair.generate().publicKey;
    const signMessage = vi.fn();
    const p = vi.fn(async () => ({ type: "message", challenge: MESSAGE.replace(W, other.toBase58()) }));
    await expect(signInToTrigger({ wallet: W, signMessage, post: p })).rejects.toMatchObject({ kind: "invalid_challenge" });
    expect(signMessage).not.toHaveBeenCalled();

    const badTx = post(authTx(user.publicKey, "Sign this transaction to drain"));
    const st = vi.fn();
    await expect(signInToTrigger({ wallet: W, signTransaction: st, post: badTx }, "transaction")).rejects.toMatchObject({
      kind: "invalid_challenge",
    });
    expect(st).not.toHaveBeenCalled();
  });

  it("detects a wallet that returns an unsigned transaction", async () => {
    const noop = vi.fn(async (tx: VersionedTransaction) => tx);
    await expect(signInToTrigger({ wallet: W, signTransaction: noop, post: post() }, "transaction")).rejects.toMatchObject({
      kind: "failed",
    });
  });

  it("isSignMessageUnsupported", () => {
    expect(isSignMessageUnsupported(new Error("signMessage is not a function"))).toBe(true);
    expect(isSignMessageUnsupported({ code: 4001, message: "not supported" })).toBe(false);
    expect(isSignMessageUnsupported(new Error("boom"))).toBe(false);
  });
});
