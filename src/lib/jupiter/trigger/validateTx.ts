// Decode-and-check for every Trigger v2 payload BEFORE the wallet is asked to
// sign it. Jupiter crafts these transactions server-side; we never sign one
// we have not inspected:
//
// - auth message:   exact documented prefix naming the connected wallet
// - auth tx:        zero blockhash (can never land), Jupiter pays the fee, only
//                   ComputeBudget + Memo, memo names the wallet
// - deposit tx:     user pays the fee, only known programs, every token/SOL
//                   movement out of the user goes to the vault (receiverAddress)
//                   or its token account for inputMint, total <= requested;
//                   craft.inputTokenAccount must be initialised in the tx with
//                   owner = vault and mint = inputMint
// - withdrawal tx:  nothing leaves the user except fees/rent; transfers credit
//                   the user's own token accounts / wallet
//
// SPL Token instructions are decoded by hand (spl-token is not a dependency).
// Rejections name the instruction index and program so a false positive on a
// first live run is easy to diagnose.

import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { base64ToBytes } from "../encoding";

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const MEMO_V1_PROGRAM_ID = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";
const ZERO_BLOCKHASH = "11111111111111111111111111111111";

export const AUTH_MESSAGE_PREFIX =
  "Sign this message to authenticate with Jupiter that you are the owner of ";
export const AUTH_TX_MEMO_PREFIX =
  "Sign this transaction to authenticate with Jupiter that you are the owner of ";

/** Priority fee ceiling when the user pays (0.01 SOL). */
export const MAX_PRIORITY_FEE_LAMPORTS = BigInt(10_000_000);
/** Largest account a deposit/withdrawal may create and fund (Token-2022 headroom). */
const MAX_CREATED_ACCOUNT_SPACE = 1024;
const DEFAULT_CU_PER_IX = 200_000;
const MAX_CU = 1_400_000;

const PROGRAM_NAMES: Record<string, string> = {
  [SYSTEM_PROGRAM_ID]: "System Program",
  [COMPUTE_BUDGET_PROGRAM_ID]: "Compute Budget",
  [MEMO_PROGRAM_ID]: "Memo",
  [MEMO_V1_PROGRAM_ID]: "Memo (v1)",
  [TOKEN_PROGRAM_ID]: "Token Program",
  [TOKEN_2022_PROGRAM_ID]: "Token-2022",
  [ATA_PROGRAM_ID]: "Associated Token Account",
};

const TOKEN_IX_NAMES: Record<number, string> = {
  0: "InitializeMint",
  1: "InitializeAccount",
  2: "InitializeMultisig",
  3: "Transfer",
  4: "Approve",
  5: "Revoke",
  6: "SetAuthority",
  7: "MintTo",
  8: "Burn",
  9: "CloseAccount",
  10: "FreezeAccount",
  11: "ThawAccount",
  12: "TransferChecked",
  13: "ApproveChecked",
  14: "MintToChecked",
  15: "BurnChecked",
  16: "InitializeAccount2",
  17: "SyncNative",
  18: "InitializeAccount3",
  19: "InitializeMultisig2",
  20: "InitializeMint2",
  21: "GetAccountDataSize",
  22: "InitializeImmutableOwner",
  23: "AmountToUiAmount",
  24: "UiAmountToAmount",
  25: "InitializeMintCloseAuthority",
  26: "TransferFeeExtension",
};

const SYSTEM_IX_NAMES: Record<number, string> = {
  0: "CreateAccount",
  1: "Assign",
  2: "Transfer",
  3: "CreateAccountWithSeed",
  4: "AdvanceNonceAccount",
  5: "WithdrawNonceAccount",
  6: "InitializeNonceAccount",
  7: "AuthorizeNonceAccount",
  8: "Allocate",
  9: "AllocateWithSeed",
  10: "AssignWithSeed",
  11: "TransferWithSeed",
  12: "UpgradeNonceAccount",
};

export type TxCheck<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export type TxInput = VersionedTransaction | Uint8Array | string;

// ---------------------------------------------------------------------------
// Decoding

interface DecodedIx {
  index: number;
  programId: string;
  /** null = loaded from an address lookup table (cannot be verified offline). */
  accounts: (string | null)[];
  data: Uint8Array;
}

interface DecodedTx {
  feePayer: string;
  signers: string[];
  recentBlockhash: string;
  usesLookups: boolean;
  instructions: DecodedIx[];
}

function toVersioned(input: TxInput): VersionedTransaction {
  if (input instanceof VersionedTransaction) return input;
  const bytes = typeof input === "string" ? base64ToBytes(input) : input;
  return VersionedTransaction.deserialize(bytes);
}

function decode(input: TxInput): DecodedTx {
  const tx = toVersioned(input);
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const lookups = msg.addressTableLookups ?? [];
  const keyAt = (i: number): string | null => (i < keys.length ? keys[i] : null);
  return {
    feePayer: keys[0],
    signers: keys.slice(0, msg.header.numRequiredSignatures),
    recentBlockhash: msg.recentBlockhash,
    usesLookups: lookups.length > 0,
    instructions: msg.compiledInstructions.map((ix, index) => ({
      index,
      programId: keyAt(ix.programIdIndex) ?? "<lookup table>",
      accounts: ix.accountKeyIndexes.map(keyAt),
      data: ix.data,
    })),
  };
}

function programName(id: string): string {
  return PROGRAM_NAMES[id] ? `${PROGRAM_NAMES[id]} (${id})` : id;
}

function where(ix: DecodedIx, what: string): string {
  const name = PROGRAM_NAMES[ix.programId] ?? ix.programId;
  return `Instruction #${ix.index + 1} (${name} ${what})`;
}

function short(key: string | null): string {
  if (!key) return "<lookup table account>";
  return key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
}

function u32(data: Uint8Array, offset: number): number {
  if (data.length < offset + 4) throw new RangeError("short data");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function u64(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) throw new RangeError("short data");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function pubkeyAt(data: Uint8Array, offset: number): string {
  if (data.length < offset + 32) throw new RangeError("short data");
  return new PublicKey(data.slice(offset, offset + 32)).toBase58();
}

function rentExempt(space: bigint): bigint {
  // (account bytes + 128 overhead) * 3480 lamports/byte-year * 2 years.
  return (space + BigInt(128)) * BigInt(3480) * BigInt(2);
}

function lamportsToSol(l: bigint): string {
  const s = l.toString().padStart(10, "0");
  const int = s.slice(0, -9);
  const frac = s.slice(-9).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Associated token account of `owner` for `mint` under `tokenProgram`. */
export function deriveAta(owner: string, mint: string, tokenProgram: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBytes(),
      new PublicKey(tokenProgram).toBytes(),
      new PublicKey(mint).toBytes(),
    ],
    new PublicKey(ATA_PROGRAM_ID)
  )[0].toBase58();
}

function atasFor(owner: string, mint: string): string[] {
  return [deriveAta(owner, mint, TOKEN_PROGRAM_ID), deriveAta(owner, mint, TOKEN_2022_PROGRAM_ID)];
}

const isTokenProgram = (id: string) => id === TOKEN_PROGRAM_ID || id === TOKEN_2022_PROGRAM_ID;
const isMemoProgram = (id: string) => id === MEMO_PROGRAM_ID || id === MEMO_V1_PROGRAM_ID;

// ---------------------------------------------------------------------------
// Compute budget

interface BudgetState {
  unitLimit: number | null;
  microLamportsPerCu: bigint;
}

function checkComputeBudget(ix: DecodedIx, budget: BudgetState): string | null {
  const kind = ix.data[0];
  try {
    switch (kind) {
      case 1: // RequestHeapFrame
      case 4: // SetLoadedAccountsDataSizeLimit
        u32(ix.data, 1);
        return null;
      case 2:
        budget.unitLimit = u32(ix.data, 1);
        return null;
      case 3:
        budget.microLamportsPerCu = u64(ix.data, 1);
        return null;
      default:
        return `${where(ix, `instruction type ${kind}`)} is not an allowed compute-budget instruction`;
    }
  } catch {
    return `${where(ix, "data")} is malformed`;
  }
}

function priorityFeeLamports(budget: BudgetState, instructionCount: number): bigint {
  const limit =
    budget.unitLimit ?? Math.min(MAX_CU, DEFAULT_CU_PER_IX * Math.max(1, instructionCount));
  const micro = budget.microLamportsPerCu * BigInt(limit);
  const million = BigInt(1_000_000);
  return (micro + million - BigInt(1)) / million;
}

function checkPriorityFee(tx: DecodedTx, budget: BudgetState, user: string): string | null {
  if (tx.feePayer !== user) return null;
  const nonBudget = tx.instructions.filter((i) => i.programId !== COMPUTE_BUDGET_PROGRAM_ID).length;
  const fee = priorityFeeLamports(budget, nonBudget);
  if (fee > MAX_PRIORITY_FEE_LAMPORTS) {
    return `Priority fee of ${lamportsToSol(fee)} SOL is above the ${lamportsToSol(MAX_PRIORITY_FEE_LAMPORTS)} SOL safety limit`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth

function nextCharOk(text: string, at: number): boolean {
  if (at >= text.length) return true;
  return text[at] === "." || /\s/.test(text[at]);
}

/** Checks a message-mode challenge before signMessage. */
export function validateAuthMessage(challenge: unknown, wallet: string): TxCheck {
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > 1024) {
    return { ok: false, reason: "Sign-in challenge is missing or too long" };
  }
  const prefix = AUTH_MESSAGE_PREFIX + wallet;
  if (!challenge.startsWith(prefix) || !nextCharOk(challenge, prefix.length)) {
    return {
      ok: false,
      reason: "Sign-in challenge does not name your connected wallet in Jupiter's expected wording",
    };
  }
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(challenge)) {
    return { ok: false, reason: "Sign-in challenge contains unexpected control characters" };
  }
  return { ok: true };
}

/** Checks a transaction-mode challenge (Ledger) before signTransaction. */
export function validateAuthTransaction(input: TxInput, wallet: string): TxCheck {
  let tx: DecodedTx;
  try {
    tx = decode(input);
  } catch {
    return { ok: false, reason: "Could not decode the sign-in transaction" };
  }
  if (tx.recentBlockhash !== ZERO_BLOCKHASH) {
    return {
      ok: false,
      reason: "Sign-in transaction has a real blockhash, so it could land on chain. Refusing to sign",
    };
  }
  if (tx.usesLookups) {
    return { ok: false, reason: "Sign-in transaction uses address lookup tables" };
  }
  if (tx.feePayer === wallet) {
    return { ok: false, reason: "Sign-in transaction would make your wallet pay a fee" };
  }
  if (!tx.signers.includes(wallet)) {
    return { ok: false, reason: "Sign-in transaction does not ask for your wallet's signature" };
  }
  let memos = 0;
  const budget: BudgetState = { unitLimit: null, microLamportsPerCu: BigInt(0) };
  for (const ix of tx.instructions) {
    if (ix.programId === COMPUTE_BUDGET_PROGRAM_ID) {
      const err = checkComputeBudget(ix, budget);
      if (err) return { ok: false, reason: err };
      continue;
    }
    if (isMemoProgram(ix.programId)) {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(ix.data);
      } catch {
        return { ok: false, reason: `${where(ix, "memo")} is not valid text` };
      }
      const prefix = AUTH_TX_MEMO_PREFIX + wallet;
      if (!text.startsWith(prefix) || !nextCharOk(text, prefix.length)) {
        return {
          ok: false,
          reason: `${where(ix, "memo")} does not name your connected wallet in Jupiter's expected wording`,
        };
      }
      memos++;
      continue;
    }
    return {
      ok: false,
      reason: `${where(ix, "call")}: program ${programName(ix.programId)} is not allowed in a sign-in transaction`,
    };
  }
  if (memos === 0) return { ok: false, reason: "Sign-in transaction has no memo challenge" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shared token/system decoding

interface TokenInit {
  account: string;
  mint: string;
  owner: string;
}

/** Collects accounts initialised as token accounts / ATAs in this tx. */
function collectInits(tx: DecodedTx): TokenInit[] {
  const out: TokenInit[] = [];
  for (const ix of tx.instructions) {
    try {
      if (isTokenProgram(ix.programId)) {
        const kind = ix.data[0];
        const [account, mint, ownerAcc] = ix.accounts;
        if (!account || !mint) continue;
        if (kind === 1 && ownerAcc) out.push({ account, mint, owner: ownerAcc });
        if (kind === 16 || kind === 18) out.push({ account, mint, owner: pubkeyAt(ix.data, 1) });
      } else if (ix.programId === ATA_PROGRAM_ID) {
        const [, ata, wallet, mint] = ix.accounts;
        if (ata && wallet && mint) out.push({ account: ata, mint, owner: wallet });
      }
    } catch {
      // Malformed: the main pass reports it.
    }
  }
  return out;
}

interface CreateAccountInfo {
  from: string | null;
  account: string | null;
  lamports: bigint;
  space: bigint;
  owner: string;
}

function decodeCreateAccount(ix: DecodedIx, kind: number): CreateAccountInfo {
  const [from, account] = ix.accounts;
  if (kind === 0) {
    return {
      from,
      account,
      lamports: u64(ix.data, 4),
      space: u64(ix.data, 12),
      owner: pubkeyAt(ix.data, 20),
    };
  }
  // CreateAccountWithSeed: base(32) | seed (u64 len + bytes) | lamports | space | owner
  const seedLen = Number(u64(ix.data, 36));
  if (seedLen > 32) throw new RangeError("seed too long");
  const o = 44 + seedLen;
  return {
    from,
    account,
    lamports: u64(ix.data, o),
    space: u64(ix.data, o + 8),
    owner: pubkeyAt(ix.data, o + 16),
  };
}

function checkAtaCreate(ix: DecodedIx): string | null {
  const kind = ix.data.length === 0 ? 0 : ix.data[0];
  if (kind !== 0 && kind !== 1) {
    return `${where(ix, "RecoverNested")} is not allowed`;
  }
  const [payer, ata, wallet, mint, , tokenProgram] = ix.accounts;
  if (!payer || !ata || !wallet || !mint || !tokenProgram) {
    return `${where(ix, "Create")} uses accounts we cannot verify`;
  }
  if (!isTokenProgram(tokenProgram)) {
    return `${where(ix, "Create")} names unknown token program ${tokenProgram}`;
  }
  if (deriveAta(wallet, mint, tokenProgram) !== ata) {
    return `${where(ix, "Create")}: account ${short(ata)} is not the associated token account of ${short(wallet)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deposit

export interface DepositExpectation {
  user: string;
  inputMint: string;
  outputMint: string;
  /** Requested amount in base units. */
  amount: string;
  /** craft.receiverAddress (the vault wallet). */
  receiverAddress: string;
  /** craft.inputTokenAccount, when returned. */
  inputTokenAccount?: string;
  /** From GET /vault: receiverAddress must equal it when known. */
  vaultPubkey?: string;
  /** craft.tokenDecimals, checked against TransferChecked. */
  tokenDecimals?: number;
}

export interface DepositCheckDetails {
  /** Base units of inputMint moved into the vault. */
  depositedAmount: string;
  priorityFeeLamports: string;
}

export function validateDepositTransaction(
  input: TxInput,
  exp: DepositExpectation
): TxCheck<DepositCheckDetails> {
  const { user, inputMint, outputMint, receiverAddress } = exp;
  if (exp.vaultPubkey && receiverAddress !== exp.vaultPubkey) {
    return {
      ok: false,
      reason: `Deposit goes to ${short(receiverAddress)}, which is not your Jupiter vault (${short(exp.vaultPubkey)})`,
    };
  }
  if (receiverAddress === user) {
    return { ok: false, reason: "Deposit receiver is your own wallet" };
  }
  let tx: DecodedTx;
  try {
    tx = decode(input);
  } catch {
    return { ok: false, reason: "Could not decode the deposit transaction" };
  }
  if (tx.feePayer !== user) {
    return { ok: false, reason: `Deposit fee payer is ${short(tx.feePayer)}, not your wallet` };
  }

  let requested: bigint;
  try {
    requested = BigInt(exp.amount);
  } catch {
    return { ok: false, reason: "Invalid requested amount" };
  }

  try {
    const isSol = inputMint === NATIVE_MINT;
    const inits = collectInits(tx);
    // Accounts that hold the vault's inputMint for this order: the vault's
    // ATAs, and accounts set up in THIS tx with owner = vault. The craft's
    // inputTokenAccount is never trusted on its own word: the SPL Token
    // program only checks the destination's mint, so an arbitrary existing
    // account named there would otherwise pass as "your vault".
    const vaultInput = new Set<string>(atasFor(receiverAddress, inputMint));
    // The user's own accounts for inputMint (ATAs + temp accounts made here).
    const userInput = new Set<string>(atasFor(user, inputMint));
    const initialised = new Set<string>();
    for (const i of inits) {
      initialised.add(i.account);
      if (i.mint === inputMint && i.owner === receiverAddress) vaultInput.add(i.account);
      if (i.mint === inputMint && i.owner === user) userInput.add(i.account);
    }
    // Real crafts create inputTokenAccount here (CreateAccountWithSeed, base =
    // vault) and InitializeAccount3 it with owner = vault, so it is in
    // vaultInput by now. Anything else is refused.
    if (exp.inputTokenAccount) {
      const init = inits.find((i) => i.account === exp.inputTokenAccount);
      if (!init) {
        return {
          ok: false,
          reason: `The order's token account ${short(exp.inputTokenAccount)} is not set up in this transaction, so it cannot be verified as your vault's`,
        };
      }
      if (init.owner !== receiverAddress || init.mint !== inputMint) {
        return {
          ok: false,
          reason: `The order's token account ${short(exp.inputTokenAccount)} is set up for ${short(init.owner)} and mint ${short(init.mint)}, not your vault and the input token`,
        };
      }
    }

    let deposited = BigInt(0);
    const budget: BudgetState = { unitLimit: null, microLamportsPerCu: BigInt(0) };

    for (const ix of tx.instructions) {
      const pid = ix.programId;

      if (pid === COMPUTE_BUDGET_PROGRAM_ID) {
        const err = checkComputeBudget(ix, budget);
        if (err) return { ok: false, reason: err };
        continue;
      }
      if (isMemoProgram(pid)) continue;

      if (pid === SYSTEM_PROGRAM_ID) {
        const kind = u32(ix.data, 0);
        const name = SYSTEM_IX_NAMES[kind] ?? `instruction ${kind}`;
        if (kind === 2) {
          const [from, to] = ix.accounts;
          const lamports = u64(ix.data, 4);
          if (from !== user) continue; // someone else's lamports
          if (!to) return { ok: false, reason: `${where(ix, name)} sends SOL to an account we cannot verify` };
          if (isSol && (vaultInput.has(to) || to === receiverAddress)) {
            deposited += lamports; // native SOL deposit (wrap into the vault)
            continue;
          }
          if (isSol && userInput.has(to)) continue; // wrapping into your own account
          return {
            ok: false,
            reason: `${where(ix, name)} sends ${lamportsToSol(lamports)} SOL from your wallet to ${short(to)}, which is not your Jupiter vault`,
          };
        }
        if (kind === 0 || kind === 3) {
          const c = decodeCreateAccount(ix, kind);
          if (c.from !== user) continue;
          if (!c.account) return { ok: false, reason: `${where(ix, name)} creates an account we cannot verify` };
          if (!isTokenProgram(c.owner)) {
            return { ok: false, reason: `${where(ix, name)} creates an account owned by ${programName(c.owner)}` };
          }
          if (c.space > BigInt(MAX_CREATED_ACCOUNT_SPACE)) {
            return { ok: false, reason: `${where(ix, name)} creates an oversized account (${c.space} bytes)` };
          }
          if (!initialised.has(c.account)) {
            return { ok: false, reason: `${where(ix, name)} funds ${short(c.account)}, which is never set up as a token account` };
          }
          const excess = c.lamports - rentExempt(c.space);
          if (excess > BigInt(0)) {
            if (isSol && vaultInput.has(c.account)) deposited += excess;
            else if (!(isSol && userInput.has(c.account))) {
              return {
                ok: false,
                reason: `${where(ix, name)} puts ${lamportsToSol(excess)} SOL more than rent into ${short(c.account)}`,
              };
            }
          }
          continue;
        }
        return { ok: false, reason: `${where(ix, name)} is not allowed in a deposit` };
      }

      if (pid === ATA_PROGRAM_ID) {
        const err = checkAtaCreate(ix);
        if (err) return { ok: false, reason: err };
        const [, , wallet, mint] = ix.accounts;
        if (wallet === receiverAddress) {
          if (mint !== inputMint && mint !== outputMint) {
            return { ok: false, reason: `${where(ix, "Create")} opens a vault account for an unrelated mint ${short(mint)}` };
          }
        } else if (wallet === user) {
          if (mint !== inputMint && mint !== outputMint) {
            return { ok: false, reason: `${where(ix, "Create")} opens your account for an unrelated mint ${short(mint)}` };
          }
        } else {
          return { ok: false, reason: `${where(ix, "Create")} opens an account for ${short(wallet)}, which is neither you nor your vault` };
        }
        continue;
      }

      if (isTokenProgram(pid)) {
        const kind = ix.data.length > 0 ? ix.data[0] : -1;
        const name = TOKEN_IX_NAMES[kind] ?? `instruction ${kind}`;
        switch (kind) {
          case 1:
          case 16:
          case 18: {
            const init = inits.find((i) => i.account === ix.accounts[0]);
            if (!init) return { ok: false, reason: `${where(ix, name)} uses accounts we cannot verify` };
            if (init.owner !== user && init.owner !== receiverAddress) {
              return { ok: false, reason: `${where(ix, name)} sets up an account owned by ${short(init.owner)}` };
            }
            if (init.mint !== inputMint && init.mint !== outputMint) {
              return { ok: false, reason: `${where(ix, name)} sets up an account for an unrelated mint ${short(init.mint)}` };
            }
            continue;
          }
          case 22: // InitializeImmutableOwner: no funds involved
            continue;
          case 3:
          case 12: {
            const checked = kind === 12;
            const [source, a1, a2, a3] = ix.accounts;
            const dest = checked ? a2 : a1;
            const authority = checked ? a3 : a2;
            const amount = u64(ix.data, 1);
            if (checked) {
              if (a1 !== inputMint) {
                return { ok: false, reason: `${where(ix, name)} moves mint ${short(a1)}, not the order's input token` };
              }
              if (exp.tokenDecimals !== undefined && ix.data[9] !== exp.tokenDecimals) {
                return { ok: false, reason: `${where(ix, name)} uses ${ix.data[9]} decimals, expected ${exp.tokenDecimals}` };
              }
            }
            if (authority !== user) {
              return { ok: false, reason: `${where(ix, name)} is authorised by ${short(authority)}, not your wallet` };
            }
            if (!source || !userInput.has(source)) {
              return { ok: false, reason: `${where(ix, name)} spends from ${short(source)}, which is not your account for the input token` };
            }
            if (!dest || !vaultInput.has(dest)) {
              return { ok: false, reason: `${where(ix, name)} sends tokens to ${short(dest)}, which is not your vault's account for this order` };
            }
            deposited += amount;
            continue;
          }
          case 17: {
            const [account] = ix.accounts;
            if (!isSol || !account || (!vaultInput.has(account) && !userInput.has(account))) {
              return { ok: false, reason: `${where(ix, name)} targets an unexpected account ${short(account)}` };
            }
            continue;
          }
          case 9: {
            const [account, dest, owner] = ix.accounts;
            if (owner === user && dest === user && account && userInput.has(account)) continue;
            return { ok: false, reason: `${where(ix, name)} closes ${short(account)} and sends its SOL to ${short(dest)}` };
          }
          default:
            return { ok: false, reason: `${where(ix, name)} is not allowed in a deposit` };
        }
      }

      return {
        ok: false,
        reason: `${where(ix, "call")}: program ${programName(pid)} is not allowed in a deposit`,
      };
    }

    if (deposited === BigInt(0)) {
      return { ok: false, reason: "Deposit does not move any of the input token into your vault" };
    }
    if (deposited > requested) {
      return {
        ok: false,
        reason: `Deposit moves ${deposited} base units, more than the ${requested} you asked for`,
      };
    }
    const feeErr = checkPriorityFee(tx, budget, user);
    if (feeErr) return { ok: false, reason: feeErr };
    return {
      ok: true,
      depositedAmount: deposited.toString(),
      priorityFeeLamports: priorityFeeLamports(
        budget,
        tx.instructions.filter((i) => i.programId !== COMPUTE_BUDGET_PROGRAM_ID).length
      ).toString(),
    };
  } catch {
    return { ok: false, reason: "Deposit transaction has malformed instruction data" };
  }
}

// ---------------------------------------------------------------------------
// Withdrawal (cancel / withdraw)

export interface WithdrawalExpectation {
  user: string;
  /** The order's mints (input and output): credits may land in either ATA. */
  mints: string[];
}

export interface WithdrawalCheckDetails {
  /** Number of instructions that credit the user. */
  credits: number;
}

export function validateWithdrawalTransaction(
  input: TxInput,
  exp: WithdrawalExpectation
): TxCheck<WithdrawalCheckDetails> {
  const { user } = exp;
  let tx: DecodedTx;
  try {
    tx = decode(input);
  } catch {
    return { ok: false, reason: "Could not decode the withdrawal transaction" };
  }
  if (!tx.signers.includes(user)) {
    return { ok: false, reason: "Withdrawal transaction does not ask for your wallet's signature" };
  }
  try {
    const userAccounts = new Set<string>();
    for (const m of exp.mints) for (const a of atasFor(user, m)) userAccounts.add(a);
    const inits = collectInits(tx);
    for (const i of inits) if (i.owner === user) userAccounts.add(i.account);
    const initialised = new Set(inits.map((i) => i.account));

    let credits = 0;
    const budget: BudgetState = { unitLimit: null, microLamportsPerCu: BigInt(0) };

    for (const ix of tx.instructions) {
      const pid = ix.programId;
      if (pid === COMPUTE_BUDGET_PROGRAM_ID) {
        const err = checkComputeBudget(ix, budget);
        if (err) return { ok: false, reason: err };
        continue;
      }
      if (isMemoProgram(pid)) continue;

      if (pid === SYSTEM_PROGRAM_ID) {
        const kind = u32(ix.data, 0);
        const name = SYSTEM_IX_NAMES[kind] ?? `instruction ${kind}`;
        if (kind === 2) {
          const [from, to] = ix.accounts;
          if (from === user) {
            return { ok: false, reason: `${where(ix, name)} sends SOL out of your wallet` };
          }
          if (to === user) credits++;
          continue;
        }
        if (kind === 0 || kind === 3) {
          const c = decodeCreateAccount(ix, kind);
          if (c.from !== user) continue;
          if (!c.account || !initialised.has(c.account) || !userAccounts.has(c.account)) {
            return { ok: false, reason: `${where(ix, name)} spends your SOL on an account that is not yours` };
          }
          if (!isTokenProgram(c.owner) || c.space > BigInt(MAX_CREATED_ACCOUNT_SPACE)) {
            return { ok: false, reason: `${where(ix, name)} creates an unexpected account` };
          }
          if (c.lamports > rentExempt(c.space)) {
            return { ok: false, reason: `${where(ix, name)} puts more than rent into a new account` };
          }
          continue;
        }
        return { ok: false, reason: `${where(ix, name)} is not allowed in a withdrawal` };
      }

      if (pid === ATA_PROGRAM_ID) {
        const err = checkAtaCreate(ix);
        if (err) return { ok: false, reason: err };
        const [payer, , wallet] = ix.accounts;
        if (payer === user && wallet !== user) {
          return { ok: false, reason: `${where(ix, "Create")} makes you pay rent for ${short(wallet)}'s account` };
        }
        continue;
      }

      if (isTokenProgram(pid)) {
        const kind = ix.data.length > 0 ? ix.data[0] : -1;
        const name = TOKEN_IX_NAMES[kind] ?? `instruction ${kind}`;
        switch (kind) {
          case 1:
          case 16:
          case 18: {
            const init = inits.find((i) => i.account === ix.accounts[0]);
            if (!init || init.owner !== user) {
              return { ok: false, reason: `${where(ix, name)} sets up an account that is not yours` };
            }
            continue;
          }
          case 22:
          case 17:
            continue;
          case 3:
          case 12: {
            const checked = kind === 12;
            const [, a1, a2, a3] = ix.accounts;
            const dest = checked ? a2 : a1;
            const authority = checked ? a3 : a2;
            u64(ix.data, 1);
            if (authority === user) {
              return { ok: false, reason: `${where(ix, name)} moves tokens out of your wallet` };
            }
            if (!dest || !userAccounts.has(dest)) {
              return { ok: false, reason: `${where(ix, name)} sends tokens to ${short(dest)}, which is not your token account` };
            }
            credits++;
            continue;
          }
          case 9: {
            const [account, dest, owner] = ix.accounts;
            if (dest !== user) {
              return { ok: false, reason: `${where(ix, name)} sends the closed account's SOL to ${short(dest)}, not your wallet` };
            }
            if (owner === user && (!account || !userAccounts.has(account))) {
              return { ok: false, reason: `${where(ix, name)} closes an unexpected account of yours` };
            }
            if (owner !== user) credits++;
            continue;
          }
          default:
            return { ok: false, reason: `${where(ix, name)} is not allowed in a withdrawal` };
        }
      }

      return {
        ok: false,
        reason: `${where(ix, "call")}: program ${programName(pid)} is not allowed in a withdrawal`,
      };
    }

    if (credits === 0) {
      return { ok: false, reason: "Withdrawal transaction does not return anything to your wallet" };
    }
    const feeErr = checkPriorityFee(tx, budget, user);
    if (feeErr) return { ok: false, reason: feeErr };
    return { ok: true, credits };
  } catch {
    return { ok: false, reason: "Withdrawal transaction has malformed instruction data" };
  }
}
