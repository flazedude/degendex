import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { bytesToBase64 } from "../encoding";
import {
  ATA_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  deriveAta,
  validateAuthMessage,
  validateAuthTransaction,
  validateDepositTransaction,
  validateWithdrawalTransaction,
} from "./validateTx";

// --- Real samples (research probes, 2026-10-14) ------------------------------

const PROBE_WALLET = "6xx2xgnKNG5LWiNxWdjtGjtwtcseZfaaM53KxHA48eku";
const PROBE_MESSAGE =
  "Sign this message to authenticate with Jupiter that you are the owner of 6xx2xgnKNG5LWiNxWdjtGjtwtcseZfaaM53KxHA48eku.\n\nThis challenge expires at 2026-10-14T06:03:09.295Z with the nonce of 01a138fd-568f-7758-83a3-f731d8d553d4.";
const PROBE_AUTH_TX =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgECBAr8+BV5WMuM2M00CWyZkoNBPbU3RsPA9C5rPgPWZMOyWJ+bJYKjZhwGq+VUs/2d4onl2cIZsxpeslKox++H3I4DBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAVKU1qZKSEGTSTocWDaOHx8NbXdvJK7geQfqEBBBUSNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAwEB5gFTaWduIHRoaXMgdHJhbnNhY3Rpb24gdG8gYXV0aGVudGljYXRlIHdpdGggSnVwaXRlciB0aGF0IHlvdSBhcmUgdGhlIG93bmVyIG9mIDZ4eDJ4Z25LTkc1TFdpTnhXZGp0R2p0d3Rjc2VaZmFhTTUzS3hIQTQ4ZWt1LgoKVGhpcyBjaGFsbGVuZ2UgZXhwaXJlcyBhdCAyMDI2LTEwLTE0VDA2OjAzOjE0Ljc0MFogd2l0aCB0aGUgbm9uY2Ugb2YgMDFhMTM4ZmQtNmJkNC03M2NlLTlkNzEtOThkOTdlODk5YjZkLgIABQLAXBUAAgAJAwAAAAAAAAAA";
// OpenAPI DCA cancel example: vault ATA -> user's USDC ATA, then close to user.
const DOC_DCA_WITHDRAW_TX =
  "AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBAgdyOCX48yeQcZusgzCLBJ+otTpXtR9YKzHDx3aLqYwC+0vQ4YrooVs15oSv6alpvSIyPs+Vo55usVe/6EytcDKmDUjHKsrOFPVwGfmQFwHHgWST75hdcLkGE1QZ/OgrO9V7X8BkIOtYGIrydcacmuIKcdfd6e/c7eONpxrCoSbqmM5Q+ul2G2Ootg7YYGSKJ3qW1hW2uKHAvmby4AdEXypFAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqSI5PGNkRpV42tULB0GGLK8o3q7WErcVy5goaCJGrByHBAUABQJQAgAABQAJA5DQAwAAAAAABgQDBAECCQMALTEBAAAAAAYDAwABAQk=";
const DOC_DCA_USER = "8gs8rXavMQRqoAoMhCfo79r2wndgSn93FLSWErdHp82n";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BH = "3JbUvZ3vPFCMg8SJfU9DoaAKaEbbvpTQCEwzx5Ka99BL";
const ZERO_BH = "11111111111111111111111111111111";

// --- Builders ----------------------------------------------------------------

const pk = () => Keypair.generate().publicKey;
const P = (s: string) => new PublicKey(s);

function u64le(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return Array.from(b);
}

function ix(programId: string, keys: [PublicKey, boolean, boolean][], data: number[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: P(programId),
    keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.from(data),
  });
}

const transfer = (source: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint, prog = TOKEN_PROGRAM_ID) =>
  ix(prog, [[source, false, true], [dest, false, true], [authority, true, false]], [3, ...u64le(amount)]);
const transferChecked = (
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint,
  decimals: number,
  prog = TOKEN_PROGRAM_ID
) =>
  ix(prog, [[source, false, true], [mint, false, false], [dest, false, true], [authority, true, false]], [
    12,
    ...u64le(amount),
    decimals,
  ]);
const syncNative = (account: PublicKey) => ix(TOKEN_PROGRAM_ID, [[account, false, true]], [17]);
const closeAccount = (account: PublicKey, dest: PublicKey, owner: PublicKey) =>
  ix(TOKEN_PROGRAM_ID, [[account, false, true], [dest, false, true], [owner, true, false]], [9]);
const initAccount3 = (account: PublicKey, mint: PublicKey, owner: PublicKey) =>
  ix(TOKEN_PROGRAM_ID, [[account, false, true], [mint, false, false]], [18, ...Array.from(owner.toBytes())]);
const approve = (source: PublicKey, delegate: PublicKey, owner: PublicKey) =>
  ix(TOKEN_PROGRAM_ID, [[source, false, true], [delegate, false, false], [owner, true, false]], [4, ...u64le(BigInt(1))]);
const setAuthority = (account: PublicKey, owner: PublicKey) =>
  ix(TOKEN_PROGRAM_ID, [[account, false, true], [owner, true, false]], [6, 2, 0]);
const ataCreate = (payer: PublicKey, wallet: PublicKey, mint: PublicKey, prog = TOKEN_PROGRAM_ID, ata?: PublicKey) =>
  ix(
    ATA_PROGRAM_ID,
    [
      [payer, true, true],
      [ata ?? P(deriveAta(wallet.toBase58(), mint.toBase58(), prog)), false, true],
      [wallet, false, false],
      [mint, false, false],
      [SystemProgram.programId, false, false],
      [P(prog), false, false],
    ],
    [1]
  );
const memo = (text: string, signer: PublicKey) =>
  new TransactionInstruction({
    programId: P(MEMO_PROGRAM_ID),
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });

function build(payer: PublicKey, instructions: TransactionInstruction[], blockhash = BH, alts?: AddressLookupTableAccount[]) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions });
  return new VersionedTransaction(alts ? msg.compileToV0Message(alts) : msg.compileToLegacyMessage());
}

const ata = (owner: PublicKey | string, mint: PublicKey | string, prog = TOKEN_PROGRAM_ID) =>
  P(deriveAta(owner.toString(), mint.toString(), prog));

function expectFail(r: { ok: boolean; reason?: string }, re: RegExp) {
  expect(r.ok).toBe(false);
  expect((r as { reason: string }).reason).toMatch(re);
}

// --- Tests -------------------------------------------------------------------

describe("deriveAta", () => {
  it("matches the documented withdrawal destination", () => {
    expect(deriveAta(DOC_DCA_USER, USDC, TOKEN_PROGRAM_ID)).toBe("EtNc68FJeCY9jHgdDBZ8kUSbz55Rj4MwL35mpQ2UrDFr");
  });
});

describe("validateAuthMessage", () => {
  it("accepts the live challenge for its wallet", () => {
    expect(validateAuthMessage(PROBE_MESSAGE, PROBE_WALLET)).toEqual({ ok: true });
  });
  it("rejects other wallets, look-alike prefixes and junk", () => {
    expectFail(validateAuthMessage(PROBE_MESSAGE, DOC_DCA_USER), /does not name your connected wallet/);
    const other = pk().toBase58();
    expectFail(validateAuthMessage(PROBE_MESSAGE.replace(PROBE_WALLET, `${PROBE_WALLET}${other}`), PROBE_WALLET), /does not name/);
    expectFail(validateAuthMessage(`Hello. ${PROBE_MESSAGE}`, PROBE_WALLET), /does not name/);
    expectFail(validateAuthMessage(`${PROBE_MESSAGE}\u0007`, PROBE_WALLET), /control characters/);
    expectFail(validateAuthMessage(undefined, PROBE_WALLET), /missing/);
    expectFail(validateAuthMessage("x".repeat(2000), PROBE_WALLET), /too long/);
  });
});

describe("validateAuthTransaction", () => {
  it("accepts the live transaction challenge (legacy, zero blockhash, memo)", () => {
    expect(validateAuthTransaction(PROBE_AUTH_TX, PROBE_WALLET)).toEqual({ ok: true });
  });

  it("rejects it for another wallet", () => {
    expectFail(validateAuthTransaction(PROBE_AUTH_TX, DOC_DCA_USER), /does not ask for your wallet/);
  });

  const user = pk();
  const jup = pk();
  const text = `Sign this transaction to authenticate with Jupiter that you are the owner of ${user.toBase58()}.\n\nnonce`;

  it("accepts a synthetic equivalent and rejects dangerous variants", () => {
    expect(validateAuthTransaction(build(jup, [memo(text, user)], ZERO_BH), user.toBase58()).ok).toBe(true);
    expectFail(validateAuthTransaction(build(jup, [memo(text, user)], BH), user.toBase58()), /real blockhash/);
    expectFail(validateAuthTransaction(build(user, [memo(text, user)], ZERO_BH), user.toBase58()), /pay a fee/);
    expectFail(
      validateAuthTransaction(
        build(jup, [memo(text, user), SystemProgram.transfer({ fromPubkey: user, toPubkey: jup, lamports: 1 })], ZERO_BH),
        user.toBase58()
      ),
      /Instruction #2 .*System Program.* not allowed in a sign-in transaction/
    );
    expectFail(
      validateAuthTransaction(build(jup, [memo("Sign this transaction to send funds", user)], ZERO_BH), user.toBase58()),
      /memo\) does not name/
    );
    expectFail(validateAuthTransaction(build(jup, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })], ZERO_BH), user.toBase58()), /does not ask for your wallet/);
    const withSigner = build(jup, [memo(text, user), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 })], ZERO_BH);
    expect(validateAuthTransaction(withSigner, user.toBase58()).ok).toBe(true);
    expectFail(validateAuthTransaction("not base64!", user.toBase58()), /Could not decode/);
  });
});

describe("validateDepositTransaction", () => {
  const user = pk();
  const vault = pk();
  const attacker = pk();
  const mint = P(USDC);
  const userAta = ata(user, mint);
  const vaultAta = ata(vault, mint);
  const exp = {
    user: user.toBase58(),
    inputMint: USDC,
    outputMint: NATIVE_MINT,
    amount: "20000000",
    receiverAddress: vault.toBase58(),
    tokenDecimals: 6,
  };
  const budget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
  ];

  it("accepts an SPL deposit into the vault ATA (with ATA creation)", () => {
    const tx = build(user, [
      ...budget,
      ataCreate(user, vault, mint),
      transferChecked(userAta, mint, vaultAta, user, BigInt(20_000_000), 6),
    ]);
    const r = validateDepositTransaction(tx, { ...exp, vaultPubkey: vault.toBase58() });
    expect(r).toEqual({ ok: true, depositedAmount: "20000000", priorityFeeLamports: "2000" });
    // base64 input works too
    expect(validateDepositTransaction(bytesToBase64(tx.serialize()), exp).ok).toBe(true);
  });

  it("accepts a deposit into a fresh per-order account owned by the vault", () => {
    const orderAcct = Keypair.generate();
    const tx = build(user, [
      SystemProgram.createAccount({
        fromPubkey: user,
        newAccountPubkey: orderAcct.publicKey,
        lamports: 2_039_280,
        space: 165,
        programId: P(TOKEN_PROGRAM_ID),
      }),
      initAccount3(orderAcct.publicKey, mint, vault),
      transfer(userAta, orderAcct.publicKey, user, BigInt(15_000_000)),
    ]);
    const r = validateDepositTransaction(tx, { ...exp, inputTokenAccount: orderAcct.publicKey.toBase58() });
    expect(r.ok && r.depositedAmount).toBe("15000000");
  });

  it("accepts a Token-2022 deposit", () => {
    const t22UserAta = ata(user, mint, TOKEN_2022_PROGRAM_ID);
    const t22VaultAta = ata(vault, mint, TOKEN_2022_PROGRAM_ID);
    const tx = build(user, [transferChecked(t22UserAta, mint, t22VaultAta, user, BigInt(1), 6, TOKEN_2022_PROGRAM_ID)]);
    expect(validateDepositTransaction(tx, exp).ok).toBe(true);
  });

  it("accepts native SOL wrapped straight into the vault", () => {
    const sol = P(NATIVE_MINT);
    const vaultWsol = ata(vault, sol);
    const solExp = { ...exp, inputMint: NATIVE_MINT, outputMint: USDC, amount: "1000000000", tokenDecimals: 9 };
    const tx = build(user, [
      ataCreate(user, vault, sol),
      SystemProgram.transfer({ fromPubkey: user, toPubkey: vaultWsol, lamports: 1_000_000_000 }),
      syncNative(vaultWsol),
    ]);
    expect(validateDepositTransaction(tx, solExp)).toMatchObject({ ok: true, depositedAmount: "1000000000" });

    // createAccount funded with rent + amount, initialised for the vault
    const acct = Keypair.generate();
    const tx2 = build(user, [
      SystemProgram.createAccount({
        fromPubkey: user,
        newAccountPubkey: acct.publicKey,
        lamports: 2_039_280 + 500_000_000,
        space: 165,
        programId: P(TOKEN_PROGRAM_ID),
      }),
      initAccount3(acct.publicKey, sol, vault),
      syncNative(acct.publicKey),
    ]);
    expect(validateDepositTransaction(tx2, solExp)).toMatchObject({ ok: true, depositedAmount: "500000000" });

    // SOL sent to someone else is refused
    const tx3 = build(user, [SystemProgram.transfer({ fromPubkey: user, toPubkey: attacker, lamports: 1 })]);
    expectFail(validateDepositTransaction(tx3, solExp), /Instruction #1 \(System Program Transfer\) sends 0.000000001 SOL from your wallet/);
  });

  it("refuses more than requested, nothing deposited, or the wrong receiver", () => {
    expectFail(
      validateDepositTransaction(build(user, [transferChecked(userAta, mint, vaultAta, user, BigInt(20_000_001), 6)]), exp),
      /more than the 20000000 you asked for/
    );
    expectFail(validateDepositTransaction(build(user, [...budget]), exp), /does not move any/);
    expectFail(
      validateDepositTransaction(build(user, [transfer(userAta, vaultAta, user, BigInt(1))]), {
        ...exp,
        vaultPubkey: attacker.toBase58(),
      }),
      /not your Jupiter vault/
    );
    expectFail(
      validateDepositTransaction(build(vault, [transfer(userAta, vaultAta, user, BigInt(1))]), exp),
      /fee payer/
    );
  });

  it("refuses transfers to other accounts and dangerous token instructions", () => {
    const attackerAta = ata(attacker, mint);
    expectFail(
      validateDepositTransaction(build(user, [transferChecked(userAta, mint, attackerAta, user, BigInt(1), 6)]), exp),
      /Instruction #1 \(Token Program TransferChecked\) sends tokens to .* not your vault's account/
    );
    expectFail(
      validateDepositTransaction(build(user, [transferChecked(userAta, P(NATIVE_MINT), vaultAta, user, BigInt(1), 6)]), exp),
      /moves mint/
    );
    expectFail(
      validateDepositTransaction(build(user, [transferChecked(userAta, mint, vaultAta, user, BigInt(1), 9)]), exp),
      /decimals/
    );
    expectFail(
      validateDepositTransaction(build(user, [transfer(vaultAta, vaultAta, attacker, BigInt(1))]), exp),
      /authorised by/
    );
    expectFail(
      validateDepositTransaction(
        build(user, [approve(userAta, attacker, user), transfer(userAta, vaultAta, user, BigInt(1))]),
        exp
      ),
      /Instruction #1 \(Token Program Approve\) is not allowed in a deposit/
    );
    expectFail(
      validateDepositTransaction(build(user, [setAuthority(userAta, user), transfer(userAta, vaultAta, user, BigInt(1))]), exp),
      /SetAuthority/
    );
    expectFail(
      validateDepositTransaction(build(user, [transfer(userAta, vaultAta, user, BigInt(1)), closeAccount(userAta, attacker, user)]), exp),
      /CloseAccount\) closes/
    );
    expectFail(
      validateDepositTransaction(build(user, [transfer(userAta, vaultAta, user, BigInt(1)), ataCreate(user, attacker, mint)]), exp),
      /neither you nor your vault/
    );
    expectFail(
      validateDepositTransaction(build(user, [transfer(userAta, vaultAta, user, BigInt(1)), ataCreate(user, vault, mint, TOKEN_PROGRAM_ID, attacker)]), exp),
      /not the associated token account/
    );
    expectFail(
      validateDepositTransaction(
        build(user, [SystemProgram.assign({ accountPubkey: user, programId: attacker }), transfer(userAta, vaultAta, user, BigInt(1))]),
        exp
      ),
      /System Program Assign\) is not allowed/
    );
  });

  it("refuses unknown programs, naming them", () => {
    const evil = pk();
    expectFail(
      validateDepositTransaction(build(user, [transfer(userAta, vaultAta, user, BigInt(1)), ix(evil.toBase58(), [[user, true, true]], [0])]), exp),
      new RegExp(`Instruction #2 .*program ${evil.toBase58()} is not allowed in a deposit`)
    );
  });

  it("refuses an excessive priority fee", () => {
    const tx = build(user, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000_000 }),
      transfer(userAta, vaultAta, user, BigInt(1)),
    ]);
    expectFail(validateDepositTransaction(tx, exp), /Priority fee of 0.14 SOL is above the 0.01 SOL safety limit/);
  });

  it("refuses accounts it cannot verify (address lookup tables)", () => {
    const alt = new AddressLookupTableAccount({
      key: pk(),
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [vaultAta],
      },
    });
    const tx = build(user, [transfer(userAta, vaultAta, user, BigInt(1))], BH, [alt]);
    expect(tx.message.addressTableLookups.length).toBe(1);
    expectFail(validateDepositTransaction(tx, exp), /lookup table account/);
  });

  it("refuses rent-only createAccount for something never initialised", () => {
    const acct = Keypair.generate();
    const tx = build(user, [
      SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: acct.publicKey, lamports: 2_039_280, space: 165, programId: P(TOKEN_PROGRAM_ID) }),
      transfer(userAta, vaultAta, user, BigInt(1)),
    ]);
    expectFail(validateDepositTransaction(tx, exp), /never set up as a token account/);
  });
});

describe("validateWithdrawalTransaction", () => {
  it("accepts the documented DCA withdrawal", () => {
    expect(validateWithdrawalTransaction(DOC_DCA_WITHDRAW_TX, { user: DOC_DCA_USER, mints: [USDC, NATIVE_MINT] })).toEqual({
      ok: true,
      credits: 2,
    });
  });

  it("rejects it when the destination is not ours or we are not a signer", () => {
    expectFail(
      validateWithdrawalTransaction(DOC_DCA_WITHDRAW_TX, { user: PROBE_WALLET, mints: [USDC] }),
      /does not ask for your wallet/
    );
    // Our ATA set does not include USDC: the transfer target is unknown.
    expectFail(
      validateWithdrawalTransaction(DOC_DCA_WITHDRAW_TX, { user: DOC_DCA_USER, mints: [NATIVE_MINT] }),
      /Instruction #3 \(Token Program Transfer\) sends tokens to .* not your token account/
    );
  });

  const user = pk();
  const vault = pk();
  const jup = pk();
  const attacker = pk();
  const mint = P(USDC);
  const vaultAcct = pk();
  const userAta = ata(user, mint);
  const exp = { user: user.toBase58(), mints: [USDC, NATIVE_MINT] };

  it("accepts a SOL withdrawal that unwraps into the wallet", () => {
    const sol = P(NATIVE_MINT);
    const userWsol = ata(user, sol);
    const tx = build(user, [
      ataCreate(user, user, sol),
      transfer(vaultAcct, userWsol, vault, BigInt(5)),
      closeAccount(userWsol, user, user),
      closeAccount(vaultAcct, user, vault),
    ]);
    expect(validateWithdrawalTransaction(tx, exp)).toEqual({ ok: true, credits: 2 });
  });

  it("refuses anything that takes from the user", () => {
    expectFail(
      validateWithdrawalTransaction(build(user, [transfer(userAta, ata(attacker, mint), user, BigInt(1))]), exp),
      /moves tokens out of your wallet/
    );
    expectFail(
      validateWithdrawalTransaction(build(user, [transfer(vaultAcct, ata(attacker, mint), vault, BigInt(1))]), exp),
      /not your token account/
    );
    expectFail(
      validateWithdrawalTransaction(build(user, [transfer(vaultAcct, userAta, vault, BigInt(1)), closeAccount(vaultAcct, attacker, vault)]), exp),
      /not your wallet/
    );
    expectFail(
      validateWithdrawalTransaction(
        build(user, [transfer(vaultAcct, userAta, vault, BigInt(1)), SystemProgram.transfer({ fromPubkey: user, toPubkey: jup, lamports: 1 })]),
        exp
      ),
      /sends SOL out of your wallet/
    );
    expectFail(
      validateWithdrawalTransaction(build(user, [ataCreate(user, attacker, mint), transfer(vaultAcct, userAta, vault, BigInt(1))]), exp),
      /pay rent/
    );
    expectFail(
      validateWithdrawalTransaction(build(user, [approve(userAta, attacker, user), transfer(vaultAcct, userAta, vault, BigInt(1))]), exp),
      /Approve\) is not allowed in a withdrawal/
    );
    expectFail(validateWithdrawalTransaction(build(user, [memo("hi", user)]), exp), /does not return anything/);
  });

  it("allows Jupiter to pay the fee", () => {
    const tx = build(jup, [transfer(vaultAcct, userAta, vault, BigInt(1)), memo("x", user)]);
    expect(validateWithdrawalTransaction(tx, exp).ok).toBe(true);
  });
});
