// Kill switch for Jupiter Trigger v2 (limit orders + DCA), from
// NEXT_PUBLIC_DISABLE_TRIGGER:
//
//   unset / "" / "0" / "false"  -> "on": everything works.
//   "all"                      -> "off": the proxy answers 404 for every route
//                                 and the UI points users to jup.ag, which
//                                 manages the same per-wallet vault.
//   "1" / "new" / anything else -> "new-orders-off": no new orders (craft,
//                                 create, edit), but sign-in, the order lists,
//                                 cancel and withdraw keep working so funds
//                                 already in the vault can always come back.
//
// The client bundle inlines the value at BUILD time (a change needs a rebuild /
// redeploy). The server proxy re-reads it on every request through
// triggerModeFromEnv(), so a server-side change applies without a rebuild.

export type TriggerMode = "on" | "new-orders-off" | "off";

export const TRIGGER_FLAG_NAME = "NEXT_PUBLIC_DISABLE_TRIGGER";

export function parseTriggerMode(raw: string | undefined | null): TriggerMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "0" || v === "false") return "on";
  if (v === "all") return "off";
  // "1", "new" and any unrecognised value fail safe: stop new deposits only.
  return "new-orders-off";
}

/** Build-time mode (inlined into the client bundle). */
export const TRIGGER_MODE: TriggerMode = parseTriggerMode(process.env.NEXT_PUBLIC_DISABLE_TRIGGER);
/** New limit / DCA orders (craft, create, edit) are allowed. */
export const NEW_ORDERS_ENABLED = TRIGGER_MODE === "on";
/** Sign-in, order lists, cancel and withdraw are available. */
export const MANAGE_ENABLED = TRIGGER_MODE !== "off";
/**
 * The feature is visible at all (true unless the mode is "off"). Kept for
 * callers that only gate the whole feature; new code should use
 * NEW_ORDERS_ENABLED / MANAGE_ENABLED.
 */
export const TRIGGER_ENABLED = MANAGE_ENABLED;

/**
 * Request-time mode for the server. The env name is looked up through a
 * variable so the bundler cannot inline a build-time value.
 */
export function triggerModeFromEnv(env: Record<string, string | undefined> = process.env): TriggerMode {
  return parseTriggerMode(env[TRIGGER_FLAG_NAME]);
}

/** Proxy route names (see matchTriggerRoute) that start or change an order. */
export const NEW_ORDER_ROUTES: ReadonlySet<string> = new Set([
  "deposit/craft",
  "orders/price",
  "orders/dca",
  "orders/price/:id",
]);

/** Whether the proxy may forward `routeName` in `mode`. */
export function isTriggerRouteAllowed(mode: TriggerMode, routeName: string): boolean {
  if (mode === "off") return false;
  if (mode === "new-orders-off") return !NEW_ORDER_ROUTES.has(routeName);
  return true;
}

export const JUPITER_APP_URL = "https://jup.ag";
/** Jupiter's user-docs page with the Limit V2 / DCA V2 fee table. */
export const JUPITER_FEES_URL = "https://docs.jup.ag/user-docs/trade/spot/fees";

export const NEW_ORDERS_PAUSED_MESSAGE = "New limit orders and DCA are paused";
export const TRIGGER_OFF_MESSAGE =
  "Orders you already placed are still held by Jupiter. You can view, cancel or withdraw them at jup.ag.";
export const TRIGGER_FEES_TEXT =
  "No DEGN DEX fee. Jupiter charges its own fee when an order fills (about 0.03-0.1% plus up to 0.5% routing, per Jupiter's docs)";

/** Minimum USD value Jupiter accepts per price order and per DCA round. */
export const TRIGGER_MIN_USD = 10;
/** Jupiter's cap on active DCA orders per wallet (withdrawing ones count). */
export const MAX_ACTIVE_DCA = 10;
/** Longest expiry we offer / accept for a price order. */
export const MAX_PRICE_ORDER_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** The proxy accepts a little more than we offer, for clock skew. */
export const PROXY_MAX_EXPIRY_MS = 31 * 24 * 60 * 60 * 1000;
export const MIN_PRICE_ORDER_EXPIRY_MS = 60 * 1000;
export const DCA_MIN_INTERVAL_S = 60;
export const DCA_MAX_INTERVAL_S = 31_536_000;
export const DCA_MIN_ORDERS = 2;
/** Our own sanity cap on rounds (Jupiter has none, 10 USD/round bounds it). */
export const DCA_MAX_ORDERS = 10_000;
/** beginFillAt may be at most 30 days out (Jupiter rule). */
export const DCA_MAX_BEGIN_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
