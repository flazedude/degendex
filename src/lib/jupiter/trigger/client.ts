// Browser client for the Trigger v2 proxy (/api/jupiter/trigger/...).
//
// - Attaches the wallet's access token; refreshes proactively when it has
//   < 60 s left, and once on a Trigger 401 (authError) followed by one retry.
// - One refresh in flight per wallet (single-flight): refresh tokens rotate and
//   reusing an old one outside the grace window revokes the whole session.
// - A rejected refresh clears the session (status needs-sign-in). Never loops.
// - 429 throws a TriggerApiError with code "rate_limited" and retryAfterMs.
//
// createTriggerClient takes its dependencies so it can be unit tested; the
// default instance below is bound to the zustand store and sessionStorage.

import {
  getTriggerSession,
  useTriggerAuthStore,
  type TriggerSession,
  type TriggerSessionStatus,
} from "@/store/useTriggerAuthStore";
import { refreshTokenStorage, type RefreshTokenStorage } from "./tokenStorage";
import type { TriggerAuthTokens, TriggerVault } from "./types";

export const TRIGGER_PROXY_BASE = "/api/jupiter/trigger";
/** Refresh when the access token has less than this left. */
export const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
/** Create/confirm-cancel wait up to 45 s upstream; give the proxy room. */
export const LANDING_TIMEOUT_MS = 70_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;

export type TriggerErrorCode =
  | "http"
  | "auth_required"
  | "rate_limited"
  | "network"
  | "timeout"
  | "bad_response";

export class TriggerApiError extends Error {
  readonly status: number;
  readonly code: TriggerErrorCode;
  /** The session was rejected; the user must sign in again. */
  readonly authError: boolean;
  /** The proxy could not tell whether a transaction landed. */
  readonly unknownOutcome: boolean;
  readonly retryAfterMs?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    opts: {
      code?: TriggerErrorCode;
      authError?: boolean;
      unknownOutcome?: boolean;
      retryAfterMs?: number;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "TriggerApiError";
    this.status = status;
    this.code = opts.code ?? "http";
    this.authError = opts.authError ?? false;
    this.unknownOutcome = opts.unknownOutcome ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details;
  }
}

export function isTriggerApiError(e: unknown): e is TriggerApiError {
  return e instanceof TriggerApiError;
}

export type TriggerMethod = "GET" | "POST" | "PATCH";

export interface TriggerFetchOptions {
  method?: TriggerMethod;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** Wallet whose session authenticates the call, or false/undefined for none. */
  auth?: string | false;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TriggerClientDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  storage: RefreshTokenStorage;
  getSession: (wallet: string) => TriggerSession;
  setSession: (wallet: string, patch: Partial<TriggerSession>) => void;
  clearSession: (wallet: string, status?: TriggerSessionStatus, error?: string | null) => void;
}

interface RawResult {
  status: number;
  body: unknown;
  headers: Headers;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Parses verify/refresh tokens. Returns null if the shape is unusable. */
export function parseAuthTokens(body: unknown, nowMs: number): TriggerAuthTokens | null {
  if (!isObj(body)) return null;
  const { accessToken, refreshToken, expiresAt } = body;
  if (typeof accessToken !== "string" || !accessToken) return null;
  if (typeof refreshToken !== "string" || !refreshToken) return null;
  let exp = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) exp = expiresAt;
  // Missing/garbage expiry: assume the documented 15 minutes, minus slack.
  if (!Number.isFinite(exp) || exp <= nowMs) exp = nowMs + 14 * 60_000;
  return { accessToken, refreshToken, expiresAt: exp };
}

function parseVault(body: unknown): TriggerVault {
  if (!isObj(body)) return {};
  const out: TriggerVault = {};
  if (typeof body.userPubkey === "string") out.userPubkey = body.userPubkey;
  if (typeof body.vaultPubkey === "string") out.vaultPubkey = body.vaultPubkey;
  if (typeof body.privyVaultId === "string") out.privyVaultId = body.privyVaultId;
  return out;
}

function errorFromResult(res: RawResult): TriggerApiError {
  const b = isObj(res.body) ? res.body : {};
  const message =
    typeof b.error === "string" && b.error.trim()
      ? b.error.trim().slice(0, 300)
      : `Request failed (${res.status})`;
  if (res.status === 429) {
    const hinted = Number(b.retryAfterMs);
    const header = Number(res.headers.get("retry-after")) * 1000;
    const retryAfterMs =
      Number.isFinite(hinted) && hinted > 0
        ? hinted
        : Number.isFinite(header) && header > 0
          ? header
          : DEFAULT_RETRY_AFTER_MS;
    return new TriggerApiError("Rate limited by Jupiter, please retry shortly", 429, {
      code: "rate_limited",
      retryAfterMs,
    });
  }
  return new TriggerApiError(message, res.status, {
    authError: b.authError === true,
    unknownOutcome: b.unknownOutcome === true,
    details: isObj(b.details) ? b.details : undefined,
  });
}

/** The caller's abort signal (if any) combined with a timeout. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any([signal, timeout]);
  const ctrl = new AbortController();
  const abort = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  signal.addEventListener("abort", abort(signal), { once: true });
  timeout.addEventListener("abort", abort(timeout), { once: true });
  return ctrl.signal;
}

const authRequired = (message = "Sign in to Jupiter limit orders first") =>
  new TriggerApiError(message, 401, { code: "auth_required", authError: true });

export function createTriggerClient(deps: TriggerClientDeps) {
  const refreshes = new Map<string, Promise<string>>();
  const vaults = new Map<string, Promise<TriggerVault>>();
  /** Bumped on logout/clear so a refresh in flight cannot resurrect a session. */
  const epochs = new Map<string, number>();
  const epochOf = (w: string) => epochs.get(w) ?? 0;

  async function send(path: string, opts: TriggerFetchOptions, token: string | null): Promise<RawResult> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    const url = `${TRIGGER_PROXY_BASE}/${path}${q ? `?${q}` : ""}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        credentials: "omit",
        signal: withTimeout(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const timeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new TriggerApiError(
        timeout ? "Jupiter took too long to respond" : "Network error, could not reach the server",
        0,
        { code: timeout ? "timeout" : "network" }
      );
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, headers: res.headers };
  }

  function storeTokens(wallet: string, tokens: TriggerAuthTokens): void {
    deps.storage.write(wallet, tokens.refreshToken);
    deps.setSession(wallet, {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      status: "ready",
      error: null,
    });
  }

  /** Drops tokens locally (no network). */
  function forget(wallet: string, status: TriggerSessionStatus = "signed-out", error: string | null = null) {
    epochs.set(wallet, epochOf(wallet) + 1);
    deps.storage.clear(wallet);
    vaults.delete(wallet);
    deps.clearSession(wallet, status, error);
  }

  /** Single-flight refresh. Resolves to the new access token. */
  function refresh(wallet: string): Promise<string> {
    const inflight = refreshes.get(wallet);
    if (inflight) return inflight;
    const startEpoch = epochOf(wallet);
    const p = (async () => {
      const refreshToken = deps.storage.read(wallet);
      if (!refreshToken) {
        forget(wallet, "needs-sign-in", "Session expired. Sign in again");
        throw authRequired("Your Jupiter session expired. Sign in again");
      }
      const res = await send("auth/refresh", { method: "POST", body: { refreshToken } }, null);
      if (epochOf(wallet) !== startEpoch) {
        // Logged out meanwhile: never resurrect. Revoke what we just got.
        const late = res.status === 200 ? parseAuthTokens(res.body, deps.now()) : null;
        if (late) {
          void send("auth/logout", { method: "POST", body: { refreshToken: late.refreshToken } }, null).catch(
            () => {}
          );
        }
        throw authRequired();
      }
      if (res.status >= 200 && res.status < 300) {
        const tokens = parseAuthTokens(res.body, deps.now());
        if (!tokens) throw new TriggerApiError("Unexpected refresh response", 502, { code: "bad_response" });
        storeTokens(wallet, tokens);
        return tokens.accessToken;
      }
      if (res.status === 401 || res.status === 400) {
        // Rejected/reused/malformed refresh token: never retry it.
        forget(wallet, "needs-sign-in", "Session expired. Sign in again");
        throw authRequired("Your Jupiter session expired. Sign in again");
      }
      // 429 / 5xx / config error: keep the token (a retry within the grace
      // window is tolerated upstream) and surface the error.
      throw errorFromResult(res);
    })().finally(() => {
      refreshes.delete(wallet);
    });
    refreshes.set(wallet, p);
    return p;
  }

  function hasFreshToken(s: TriggerSession, marginMs: number): s is TriggerSession & { accessToken: string } {
    return !!s.accessToken && typeof s.expiresAt === "number" && s.expiresAt - deps.now() > marginMs;
  }

  /** Current access token, refreshing first if it is missing or nearly expired. */
  async function getAccessToken(wallet: string): Promise<{ token: string; refreshed: boolean }> {
    const s = deps.getSession(wallet);
    if (hasFreshToken(s, REFRESH_MARGIN_MS)) return { token: s.accessToken, refreshed: false };
    if (refreshes.has(wallet) || deps.storage.read(wallet)) {
      return { token: await refresh(wallet), refreshed: true };
    }
    if (hasFreshToken(s, 5_000)) return { token: s.accessToken, refreshed: false };
    throw authRequired();
  }

  async function triggerFetch<T = unknown>(path: string, opts: TriggerFetchOptions = {}): Promise<T> {
    const wallet = opts.auth || null;
    if (!wallet) {
      const res = await send(path, opts, null);
      if (res.status >= 200 && res.status < 300) return res.body as T;
      throw errorFromResult(res);
    }

    const initial = await getAccessToken(wallet);
    const refreshed = initial.refreshed;
    let token = initial.token;
    let res = await send(path, opts, token);
    if (res.status === 401 && isObj(res.body) && res.body.authError === true) {
      const current = deps.getSession(wallet);
      if (hasFreshToken(current, 0) && current.accessToken !== token) {
        token = current.accessToken; // someone else already refreshed
      } else if (!refreshed) {
        token = await refresh(wallet);
      } else {
        forget(wallet, "needs-sign-in", "Session expired. Sign in again");
        throw authRequired("Your Jupiter session expired. Sign in again");
      }
      res = await send(path, opts, token);
      if (res.status === 401 && isObj(res.body) && res.body.authError === true) {
        forget(wallet, "needs-sign-in", "Session expired. Sign in again");
        throw authRequired("Your Jupiter session expired. Sign in again");
      }
    }
    if (res.status >= 200 && res.status < 300) return res.body as T;
    throw errorFromResult(res);
  }

  /**
   * Re-establishes a session from a stored refresh token (page reload).
   * Resolves true when ready, false when the user has to sign in.
   */
  async function restoreSession(wallet: string): Promise<boolean> {
    if (hasFreshToken(deps.getSession(wallet), REFRESH_MARGIN_MS)) return true;
    if (!deps.storage.read(wallet) && !refreshes.has(wallet)) return false;
    try {
      await refresh(wallet);
      return true;
    } catch (err) {
      if (isTriggerApiError(err) && err.code !== "auth_required") {
        // Transient: keep the refresh token, let the user retry or sign in.
        deps.setSession(wallet, { status: "error", error: err.message });
      }
      return false;
    }
  }

  /** Revokes the session upstream (best effort) and drops it locally. */
  async function logout(wallet: string): Promise<void> {
    const refreshToken = deps.storage.read(wallet);
    forget(wallet, "signed-out", null);
    if (!refreshToken) return;
    try {
      await send("auth/logout", { method: "POST", body: { refreshToken } }, null);
    } catch {
      // Best effort: the access token dies within 15 minutes anyway.
    }
  }

  /** GET /vault, registering on 404 (409 = already exists = fine). Cached per wallet. */
  function ensureVault(wallet: string): Promise<TriggerVault> {
    const cached = vaults.get(wallet);
    if (cached) return cached;
    const p = (async () => {
      try {
        return parseVault(await triggerFetch("vault", { auth: wallet }));
      } catch (err) {
        if (!isTriggerApiError(err) || err.status !== 404) throw err;
      }
      try {
        return parseVault(await triggerFetch("vault/register", { auth: wallet }));
      } catch (err) {
        if (isTriggerApiError(err) && err.status === 409) return parseVault(err.details);
        throw err;
      }
    })();
    vaults.set(wallet, p);
    p.catch(() => {
      if (vaults.get(wallet) === p) vaults.delete(wallet);
    });
    return p;
  }

  return { triggerFetch, refresh, restoreSession, storeTokens, logout, forget, ensureVault, getAccessToken };
}

export type TriggerClient = ReturnType<typeof createTriggerClient>;

/** App-wide client bound to the auth store and sessionStorage. */
export const triggerClient: TriggerClient = createTriggerClient({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  storage: refreshTokenStorage,
  getSession: getTriggerSession,
  setSession: (wallet, patch) => useTriggerAuthStore.getState().setSession(wallet, patch),
  clearSession: (wallet, status, error) =>
    useTriggerAuthStore.getState().clearSession(wallet, status, error),
});

export const triggerFetch = triggerClient.triggerFetch;
export const ensureVault = triggerClient.ensureVault;
