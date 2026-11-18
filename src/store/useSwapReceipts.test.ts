import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase58 } from "@/lib/jupiter/encoding";
import type { SwapReceipt } from "@/lib/swapReceipts";

const WALLET = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const OTHER_WALLET = "11111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TIME = 1_750_000_000_000;

function receipt(index: number, changes: Partial<SwapReceipt> = {}): SwapReceipt {
  return {
    wallet: WALLET,
    signature: bytesToBase58(new Uint8Array(64).fill(index)),
    confirmedAt: TIME + index,
    input: { mint: SOL, symbol: "SOL", decimals: 9 },
    output: { mint: USDC, symbol: "USDC", decimals: 6 },
    inputAmountRaw: "10000000",
    outputAmountRaw: "1000000",
    ...changes,
  };
}

class TestStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

let storage: TestStorage;

beforeEach(() => {
  vi.resetModules();
  storage = new TestStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => vi.unstubAllGlobals());

describe("swap receipt storage", () => {
  it("persists a wallet's latest receipts across reloads without mixing wallets", async () => {
    const store = await import("./useSwapReceipts");
    const first = receipt(1);
    const latest = receipt(3);
    const other = receipt(1, { wallet: OTHER_WALLET });
    store.recordConfirmedSwap(latest);
    store.recordConfirmedSwap(first);
    store.recordConfirmedSwap(other);

    vi.resetModules();
    const { getSwapReceipts } = await import("./useSwapReceipts");
    const history = getSwapReceipts(WALLET);
    expect(history).toEqual([latest, first]);
    expect(getSwapReceipts(WALLET)).toBe(history);
    expect(getSwapReceipts(OTHER_WALLET)).toEqual([other]);
  });

  it("merges later confirmation evidence without losing recorded execution amounts", async () => {
    const { getSwapReceipts, recordConfirmedSwap } = await import("./useSwapReceipts");
    const statusOnly = receipt(2, { inputAmountRaw: null, outputAmountRaw: null });
    const actual = receipt(2, { confirmedAt: TIME + 3 });
    recordConfirmedSwap(statusOnly);
    const racingKey = storage.key(0)!;
    const racingValue = storage.getItem(racingKey)!;
    recordConfirmedSwap(actual);

    // Simulate a second tab persisting the status-only evidence concurrently.
    storage.setItem(racingKey, racingValue);

    vi.resetModules();
    const reopened = await import("./useSwapReceipts");
    const merged = { ...actual, confirmedAt: statusOnly.confirmedAt };
    expect(reopened.getSwapReceipts(WALLET)).toEqual([merged]);

    // A replay of the same status should still preserve the known amounts.
    reopened.recordConfirmedSwap(statusOnly);
    expect(reopened.getSwapReceipts(WALLET)).toEqual([merged]);
    expect(storage.length).toBe(1);
    expect(getSwapReceipts(WALLET)).toEqual([merged]);
  });

  it("keeps at most 50 newest receipts per wallet and prunes older stored entries", async () => {
    const { getSwapReceipts, recordConfirmedSwap } = await import("./useSwapReceipts");
    for (let index = 55; index >= 1; index--) recordConfirmedSwap(receipt(index));
    recordConfirmedSwap(receipt(1, { wallet: OTHER_WALLET }));

    expect(getSwapReceipts(WALLET)).toEqual(Array.from({ length: 50 }, (_, i) => receipt(55 - i)));
    expect(getSwapReceipts(OTHER_WALLET)).toHaveLength(1);
    expect(storage.length).toBe(51);
  });

  it("includes concurrent new transactions in the wallet's storage limit", async () => {
    const { getSwapReceipts, recordConfirmedSwap } = await import("./useSwapReceipts");
    const concurrent = receipt(52);
    recordConfirmedSwap(concurrent);
    const concurrentKey = storage.key(0)!;
    const concurrentValue = storage.getItem(concurrentKey)!;
    storage.removeItem(concurrentKey);

    for (let index = 1; index <= 49; index++) recordConfirmedSwap(receipt(index));
    const write = storage.setItem.bind(storage);
    vi.spyOn(storage, "setItem").mockImplementationOnce((key, value) => {
      write(concurrentKey, concurrentValue);
      write(key, value);
    });
    recordConfirmedSwap(receipt(51));

    expect(getSwapReceipts(WALLET).slice(0, 3)).toEqual([concurrent, receipt(51), receipt(49)]);
    expect(getSwapReceipts(WALLET)).not.toContainEqual(receipt(1));
    expect(storage.length).toBe(50);
  });

  it("ignores malformed stored data and receipts that do not belong in a wallet's key", async () => {
    const { recordConfirmedSwap } = await import("./useSwapReceipts");
    const valid = receipt(3);
    for (const index of [1, 2, 3]) recordConfirmedSwap(receipt(index));
    storage.setItem(storage.key(0)!, "{invalid");
    storage.setItem(storage.key(1)!, JSON.stringify(receipt(2, { wallet: OTHER_WALLET })));

    vi.resetModules();
    const { getSwapReceipts } = await import("./useSwapReceipts");
    expect(getSwapReceipts(WALLET)).toEqual([valid]);
    expect(getSwapReceipts(OTHER_WALLET)).toEqual([]);
  });

  it("keeps newly confirmed receipts in memory when a storage write is denied", async () => {
    const { getSwapReceipts, recordConfirmedSwap } = await import("./useSwapReceipts");
    const first = receipt(1);
    const second = receipt(2);
    const latest = receipt(3);
    recordConfirmedSwap(first);
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    expect(() => recordConfirmedSwap(second)).not.toThrow();
    expect(getSwapReceipts(WALLET)).toEqual([second, first]);
    write.mockRestore();
    recordConfirmedSwap(latest);
    expect(getSwapReceipts(WALLET)).toEqual([latest, second, first]);
  });
});
