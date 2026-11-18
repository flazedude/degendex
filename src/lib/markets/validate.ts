// Pure input validation for the market-data routes and hooks.
import { isValidPubkey } from "@/lib/jupiter/params";

/** Jupiter Price v3 silently drops ids past the 50th. */
export const MAX_PRICE_IDS = 50;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parses the `ids` query param (all occurrences passed in): exactly one
 * comma-separated list of 1..50 valid mints. Duplicates are removed.
 */
export function parsePriceIds(values: string[]): Parsed<string[]> {
  if (values.length !== 1) return { ok: false, error: "Pass ids exactly once" };
  const raw = values[0];
  if (raw.length > MAX_PRICE_IDS * 45) return { ok: false, error: "ids is too long" };
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "ids is required" };
  if (ids.length > MAX_PRICE_IDS) return { ok: false, error: `At most ${MAX_PRICE_IDS} ids` };
  if (!ids.every((id) => isValidPubkey(id))) return { ok: false, error: "Invalid mint in ids" };
  return { ok: true, value: Array.from(new Set(ids)) };
}
