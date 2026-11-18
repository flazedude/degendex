// Refresh-token storage: sessionStorage, keyed per wallet, every access wrapped
// in try/catch (private mode, blocked storage, SSR). Never localStorage: the
// token must die with the tab (Jupiter's own security guidance).

export const REFRESH_TOKEN_KEY_PREFIX = "degn.trigger.rt.";

export interface RefreshTokenStorage {
  read(wallet: string): string | null;
  write(wallet: string, token: string): void;
  clear(wallet: string): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserSessionStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function createRefreshTokenStorage(
  getStorage: () => StorageLike | null = browserSessionStorage
): RefreshTokenStorage {
  return {
    read(wallet) {
      try {
        const v = getStorage()?.getItem(REFRESH_TOKEN_KEY_PREFIX + wallet);
        return typeof v === "string" && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },
    write(wallet, token) {
      try {
        getStorage()?.setItem(REFRESH_TOKEN_KEY_PREFIX + wallet, token);
      } catch {
        // Storage unavailable: the session simply will not survive a reload.
      }
    },
    clear(wallet) {
      try {
        getStorage()?.removeItem(REFRESH_TOKEN_KEY_PREFIX + wallet);
      } catch {
        // ignore
      }
    },
  };
}

export const refreshTokenStorage = createRefreshTokenStorage();
