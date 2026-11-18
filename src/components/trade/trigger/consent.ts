"use client";

// One-time custody consent for limit orders / DCA, per wallet, in
// localStorage. Every access is wrapped in try/catch: storage can be blocked
// (private mode, previews) and then consent simply lasts for this page view.

import { useSyncExternalStore } from "react";

export const CONSENT_VERSION = "v1";
const PREFIX = `degn.trigger.consent.${CONSENT_VERSION}.`;

export function consentKey(wallet: string): string {
  return `${PREFIX}${wallet}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Fallback for blocked storage, and so a consent given in this page view
// counts even if the write failed.
const memory = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** True when `wallet` has accepted the current consent text. */
export function hasConsent(wallet: string | null, storage: StorageLike | null = defaultStorage()): boolean {
  if (!wallet) return false;
  if (memory.has(wallet)) return true;
  try {
    const v = storage?.getItem(consentKey(wallet));
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

/** Records consent for `wallet` (timestamp as the value). Never throws. */
export function recordConsent(
  wallet: string,
  nowMs: number,
  storage: StorageLike | null = defaultStorage()
): void {
  memory.add(wallet);
  try {
    storage?.setItem(consentKey(wallet), String(nowMs));
  } catch {
    // Blocked storage: the in-memory copy covers this page view.
  }
  emit();
}

/** Test helper: forget in-memory consents. */
export function resetConsentMemory(): void {
  memory.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Reactive consent flag for `wallet` (false during server rendering). */
export function useTriggerConsent(wallet: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasConsent(wallet),
    () => false
  );
}
