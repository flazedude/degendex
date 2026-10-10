import type { JupiterToken } from "@/lib/jupiter/types";
import type { TokenInfo } from "./types";

function optNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Maps a Jupiter tokens/v2 item to TokenInfo, or null if it is unusable. */
export function jupiterTokenToTokenInfo(raw: unknown): TokenInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<JupiterToken> & Record<string, unknown>;
  if (
    typeof t.id !== "string" ||
    typeof t.symbol !== "string" ||
    typeof t.decimals !== "number" ||
    !Number.isInteger(t.decimals) ||
    t.decimals < 0 ||
    t.decimals > 255
  ) {
    return null;
  }
  const audit =
    t.audit && typeof t.audit === "object"
      ? {
          mintAuthorityDisabled: optBool(t.audit.mintAuthorityDisabled),
          freezeAuthorityDisabled: optBool(t.audit.freezeAuthorityDisabled),
          topHoldersPercentage: optNumber(t.audit.topHoldersPercentage),
        }
      : undefined;
  const label = t.organicScoreLabel;
  return {
    mint: t.id,
    symbol: t.symbol.slice(0, 24) || "?",
    name: typeof t.name === "string" ? t.name.slice(0, 64) : undefined,
    decimals: t.decimals,
    logoURI:
      typeof t.icon === "string" && /^https:\/\//.test(t.icon) ? t.icon : undefined,
    isVerified: optBool(t.isVerified),
    tags: Array.isArray(t.tags)
      ? t.tags.filter((x): x is string => typeof x === "string")
      : undefined,
    audit,
    organicScoreLabel:
      label === "high" || label === "medium" || label === "low" ? label : undefined,
    liquidity: optNumber(t.liquidity),
    usdPrice: optNumber(t.usdPrice),
  };
}

/** Fetches tokens through our proxy (symbol, name, mint, or comma-separated mints). */
export async function fetchTokens(
  query: string,
  signal?: AbortSignal
): Promise<TokenInfo[]> {
  const res = await fetch(
    `/api/jupiter/tokens?${new URLSearchParams({ query })}`,
    { signal }
  );
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Token search failed (${res.status})`;
    throw new Error(msg);
  }
  const seen = new Set<string>();
  const out: TokenInfo[] = [];
  for (const item of body) {
    const token = jupiterTokenToTokenInfo(item);
    if (token && !seen.has(token.mint)) {
      seen.add(token.mint);
      out.push(token);
    }
  }
  return out;
}
