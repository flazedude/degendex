"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseSwapReceipt, type SwapReceipt } from "@/lib/swapReceipts";

const MAX_RECEIPTS = 50;
const STORAGE_PREFIX = "degn:swap-receipt:v1:";
const EMPTY: readonly SwapReceipt[] = [];

const snapshots = new Map<string, readonly SwapReceipt[]>();
const unsaved = new Map<string, readonly SwapReceipt[]>();
const subscribers = new Map<string, Set<() => void>>();

function walletPrefix(wallet: string): string {
  return `${STORAGE_PREFIX}${wallet}:`;
}

function storageKey(receipt: SwapReceipt): string {
  // Separate slots prevent a late status-only write in another tab from
  // overwriting evidence that includes the actual execution amounts.
  const sent = receipt.inputAmountRaw === null ? 0 : 1;
  const received = receipt.outputAmountRaw === null ? 0 : 2;
  return `${walletPrefix(receipt.wallet)}${receipt.signature}:${sent + received}`;
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStored(wallet: string, storage: Storage): [string, SwapReceipt][] {
  const prefix = walletPrefix(wallet);
  const entries: [string, SwapReceipt][] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const value = storage.getItem(key);
    if (!value) continue;
    try {
      const receipt = parseSwapReceipt(JSON.parse(value));
      if (receipt?.wallet === wallet && storageKey(receipt) === key) entries.push([key, receipt]);
    } catch {
      // A malformed entry does not hide the rest of the wallet's history.
    }
  }
  return entries;
}

function mergeReceipt(previous: SwapReceipt | undefined, next: SwapReceipt): SwapReceipt {
  if (
    !previous ||
    previous.input.mint !== next.input.mint ||
    previous.output.mint !== next.output.mint ||
    previous.input.decimals !== next.input.decimals ||
    previous.output.decimals !== next.output.decimals
  ) return next;
  return {
    ...previous,
    confirmedAt: Math.min(previous.confirmedAt, next.confirmedAt),
    inputAmountRaw: previous.inputAmountRaw ?? next.inputAmountRaw,
    outputAmountRaw: previous.outputAmountRaw ?? next.outputAmountRaw,
  };
}

function recent(receipts: readonly SwapReceipt[]): readonly SwapReceipt[] {
  if (!receipts.length) return EMPTY;
  const unique = new Map<string, SwapReceipt>();
  for (const receipt of receipts) {
    unique.set(receipt.signature, mergeReceipt(unique.get(receipt.signature), receipt));
  }
  return [...unique.values()]
    .sort((a, b) => b.confirmedAt - a.confirmedAt || a.signature.localeCompare(b.signature))
    .slice(0, MAX_RECEIPTS);
}

function readWallet(wallet: string): readonly SwapReceipt[] {
  const storage = localStorageOrNull();
  if (storage) {
    try {
      return recent([...readStored(wallet, storage).map(([, entry]) => entry), ...(unsaved.get(wallet) ?? EMPTY)]);
    } catch {
      // A storage read failure should not hide the last known history.
    }
  }
  return snapshots.get(wallet) ?? unsaved.get(wallet) ?? EMPTY;
}

function publish(wallet: string, receipts: readonly SwapReceipt[]) {
  snapshots.set(wallet, receipts);
  subscribers.get(wallet)?.forEach((listener) => listener());
}

export function getSwapReceipts(wallet: string): readonly SwapReceipt[] {
  if (typeof window === "undefined") return EMPTY;
  const cached = snapshots.get(wallet);
  if (cached) return cached;
  const receipts = readWallet(wallet);
  snapshots.set(wallet, receipts);
  return receipts;
}

/** Saves an already confirmed receipt. Browser storage failures are best effort. */
export function recordConfirmedSwap(receipt: SwapReceipt): void {
  const parsed = parseSwapReceipt(receipt);
  if (!parsed || typeof window === "undefined") return;

  const { wallet, signature } = parsed;
  const storage = localStorageOrNull();
  if (storage) {
    try {
      const entries = readStored(wallet, storage);
      const pending = unsaved.get(wallet) ?? EMPTY;
      const merged = recent([...entries.map(([, entry]) => entry), ...pending, parsed])
        .find((entry) => entry.signature === signature);
      if (merged) {
        const key = storageKey(merged);
        storage.setItem(key, JSON.stringify(merged));
        for (const [previousKey, entry] of entries) {
          if (entry.signature === signature && previousKey !== key) storage.removeItem(previousKey);
        }
      }

      // Read again after this write so a transaction added by another tab
      // between the first read and the write counts toward the same limit.
      const saved = readStored(wallet, storage);
      const unsavedOthers = pending.filter((entry) => entry.signature !== signature);
      const history = recent([...saved.map(([, entry]) => entry), ...unsavedOthers]);
      const retained = new Set(history.map((entry) => entry.signature));
      for (const [key, entry] of saved) {
        if (!retained.has(entry.signature)) storage.removeItem(key);
      }
      const unsavedRemaining = unsavedOthers.filter((entry) => retained.has(entry.signature));
      if (unsavedRemaining.length) unsaved.set(wallet, unsavedRemaining);
      else unsaved.delete(wallet);
      publish(wallet, history);
      return;
    } catch {
      // The wallet's swap has already succeeded, even if storage is unavailable.
    }
  }

  const current = readWallet(wallet);
  unsaved.set(wallet, recent([...(unsaved.get(wallet) ?? EMPTY), parsed]));
  publish(wallet, recent([...current, parsed]));
}

function subscribe(wallet: string, onChange: () => void): () => void {
  const listeners = subscribers.get(wallet) ?? new Set();
  listeners.add(onChange);
  subscribers.set(wallet, listeners);

  function onStorage(event: StorageEvent) {
    if (event.storageArea !== localStorageOrNull()) return;
    if (event.key === null) unsaved.delete(wallet);
    if (event.key === null || event.key.startsWith(walletPrefix(wallet))) {
      snapshots.set(wallet, readWallet(wallet));
      onChange();
    }
  }

  window.addEventListener("storage", onStorage);
  // Catch changes made in another tab while no history view was mounted.
  snapshots.set(wallet, readWallet(wallet));
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(onChange);
    if (!listeners.size) subscribers.delete(wallet);
  };
}

export function useSwapReceipts(wallet: string): readonly SwapReceipt[] {
  const subscribeToWallet = useCallback((onChange: () => void) => subscribe(wallet, onChange), [wallet]);
  const getSnapshot = useCallback(() => getSwapReceipts(wallet), [wallet]);
  return useSyncExternalStore(subscribeToWallet, getSnapshot, () => EMPTY);
}
