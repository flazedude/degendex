"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { VersionedTransaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { signInToTrigger, TriggerSignInError } from "@/lib/jupiter/trigger/auth";
import { isTriggerApiError, triggerClient } from "@/lib/jupiter/trigger/client";
import { TRIGGER_ENABLED } from "@/lib/jupiter/trigger/config";
import { refreshTokenStorage } from "@/lib/jupiter/trigger/tokenStorage";
import type { TriggerChallengeType, TriggerVault } from "@/lib/jupiter/trigger/types";
import {
  EMPTY_TRIGGER_SESSION,
  useTriggerAuthStore,
  type TriggerSession,
} from "@/store/useTriggerAuthStore";

export type TriggerAuthStatus = "signed-out" | "signing-in" | "ready" | "error";

export interface UseTriggerAuthResult {
  /** Feature kill switch (NEXT_PUBLIC_DISABLE_TRIGGER). */
  enabled: boolean;
  /** Connected wallet (base58) or null. */
  wallet: string | null;
  status: TriggerAuthStatus;
  /** Last sign-in/session error, user-facing. null when none. */
  error: string | null;
  /** The wallet can sign messages (else sign-in uses a memo transaction). */
  supportsMessageSigning: boolean;
  /** Resolves true on success. Never throws. */
  signIn: (opts?: { mode?: TriggerChallengeType }) => Promise<boolean>;
  /** Revokes the session (POST auth/logout) and drops tokens. Never throws. */
  signOut: () => Promise<void>;
  /** GET vault, registering on first use (409 = exists). Cached per wallet. Throws on failure. */
  ensureVault: () => Promise<TriggerVault>;
}

/** Maps the store's session to the public 4-state status. */
export function toPublicStatus(session: TriggerSession): { status: TriggerAuthStatus; error: string | null } {
  switch (session.status) {
    case "ready":
      return { status: "ready", error: null };
    case "signing-in":
      return { status: "signing-in", error: null };
    case "error":
      return { status: "error", error: session.error ?? "Sign-in failed" };
    case "needs-sign-in":
      return { status: "signed-out", error: session.error ?? "Session expired. Sign in again" };
    default:
      return { status: "signed-out", error: session.error };
  }
}

/** The raw store session for a wallet (re-renders on change). */
export function useTriggerSession(wallet: string | null): TriggerSession {
  return useTriggerAuthStore((s) => (wallet ? s.sessions[wallet] : undefined) ?? EMPTY_TRIGGER_SESSION);
}

// Module-level so every component using the hook shares one flow per wallet.
const signInFlights = new Map<string, Promise<boolean>>();
const restoreAttempted = new Set<string>();

function friendlyError(err: unknown): string {
  if (err instanceof TriggerSignInError) return err.message;
  if (isTriggerApiError(err)) {
    if (err.code === "rate_limited") return "Jupiter is rate limiting requests. Try again in a few seconds";
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message.slice(0, 200);
  return "Sign-in failed";
}

export function useTriggerAuth(): UseTriggerAuthResult {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const queryClient = useQueryClient();
  const wallet = publicKey?.toBase58() ?? null;
  const session = useTriggerSession(wallet);
  const { status, error } = toPublicStatus(session);

  // Log out the previous wallet on disconnect / account switch.
  const prevWallet = useRef<string | null>(wallet);
  useEffect(() => {
    const prev = prevWallet.current;
    prevWallet.current = wallet;
    if (prev && prev !== wallet) {
      restoreAttempted.delete(prev);
      queryClient.removeQueries({ queryKey: ["trigger", prev] });
      void triggerClient.logout(prev);
    }
  }, [wallet, queryClient]);

  // After a reload: restore the session from the tab's refresh token, once.
  useEffect(() => {
    if (!TRIGGER_ENABLED || !wallet || restoreAttempted.has(wallet)) return;
    const s = useTriggerAuthStore.getState().sessions[wallet];
    if (s && s.status !== "signed-out") return;
    if (!refreshTokenStorage.read(wallet)) return;
    restoreAttempted.add(wallet);
    useTriggerAuthStore.getState().setSession(wallet, { status: "signing-in", error: null });
    void triggerClient.restoreSession(wallet).then((ok) => {
      const now = useTriggerAuthStore.getState().sessions[wallet];
      if (!ok && now?.status === "signing-in") {
        useTriggerAuthStore.getState().setSession(wallet, { status: "signed-out" });
      }
    });
  }, [wallet]);

  const signIn = useCallback(
    async (opts?: { mode?: TriggerChallengeType }): Promise<boolean> => {
      if (!TRIGGER_ENABLED || !wallet) return false;
      const inflight = signInFlights.get(wallet);
      if (inflight) return inflight;
      const store = useTriggerAuthStore.getState();
      const flight = (async () => {
        store.setSession(wallet, { status: "signing-in", error: null });
        try {
          const { tokens } = await signInToTrigger(
            {
              wallet,
              signMessage: signMessage ? (m) => signMessage(m) : undefined,
              signTransaction: signTransaction
                ? (tx: VersionedTransaction) => signTransaction(tx)
                : undefined,
              post: (path, body) => triggerClient.triggerFetch(path, { method: "POST", body }),
            },
            opts?.mode
          );
          // The wallet may have switched while the prompt was open.
          if (prevWallet.current !== wallet) {
            void triggerClient
              .triggerFetch("auth/logout", { method: "POST", body: { refreshToken: tokens.refreshToken } })
              .catch(() => {});
            store.setSession(wallet, { status: "signed-out", error: null });
            return false;
          }
          triggerClient.storeTokens(wallet, tokens);
          restoreAttempted.add(wallet);
          // Warm the vault (free, no signature); failures surface on first order.
          void triggerClient.ensureVault(wallet).catch(() => {});
          return true;
        } catch (err) {
          if (err instanceof TriggerSignInError && err.kind === "rejected") {
            store.setSession(wallet, { status: "signed-out", error: null });
          } else {
            store.setSession(wallet, { status: "error", error: friendlyError(err) });
          }
          return false;
        }
      })().finally(() => signInFlights.delete(wallet));
      signInFlights.set(wallet, flight);
      return flight;
    },
    [wallet, signMessage, signTransaction]
  );

  const signOut = useCallback(async () => {
    if (!wallet) return;
    queryClient.removeQueries({ queryKey: ["trigger", wallet] });
    await triggerClient.logout(wallet);
  }, [wallet, queryClient]);

  const ensureVault = useCallback(() => {
    if (!wallet) return Promise.reject(new Error("Connect your wallet first"));
    return triggerClient.ensureVault(wallet);
  }, [wallet]);

  return {
    enabled: TRIGGER_ENABLED,
    wallet,
    status: TRIGGER_ENABLED ? status : "signed-out",
    error: TRIGGER_ENABLED ? error : null,
    supportsMessageSigning: !!signMessage,
    signIn,
    signOut,
    ensureVault,
  };
}
