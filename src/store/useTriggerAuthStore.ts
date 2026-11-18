import { create } from "zustand";

// Per-wallet Jupiter Trigger session. Deliberately NOT persisted: the 15-minute
// access token lives in memory only. The rotating refresh token is kept in
// sessionStorage (src/lib/jupiter/trigger/tokenStorage.ts) so a reload in the
// same tab does not force a new wallet signature.

export type TriggerSessionStatus =
  | "signed-out"
  | "signing-in"
  | "ready"
  | "needs-sign-in"
  | "error";

export interface TriggerSession {
  accessToken: string | null;
  /** Epoch ms when accessToken expires. */
  expiresAt: number | null;
  status: TriggerSessionStatus;
  error: string | null;
}

export const EMPTY_TRIGGER_SESSION: TriggerSession = Object.freeze({
  accessToken: null,
  expiresAt: null,
  status: "signed-out",
  error: null,
}) as TriggerSession;

interface TriggerAuthState {
  sessions: Record<string, TriggerSession>;
  setSession: (wallet: string, patch: Partial<TriggerSession>) => void;
  /** Drops the access token; status defaults to signed-out. */
  clearSession: (wallet: string, status?: TriggerSessionStatus, error?: string | null) => void;
}

export const useTriggerAuthStore = create<TriggerAuthState>()((set) => ({
  sessions: {},
  setSession: (wallet, patch) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [wallet]: { ...(state.sessions[wallet] ?? EMPTY_TRIGGER_SESSION), ...patch },
      },
    })),
  clearSession: (wallet, status = "signed-out", error = null) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [wallet]: { accessToken: null, expiresAt: null, status, error },
      },
    })),
}));

export function getTriggerSession(wallet: string): TriggerSession {
  return useTriggerAuthStore.getState().sessions[wallet] ?? EMPTY_TRIGGER_SESSION;
}
