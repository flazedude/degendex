// Kill switch for Jupiter Trigger v2 (limit orders + DCA). Set
// NEXT_PUBLIC_DISABLE_TRIGGER=1 to hide the feature: the proxy then answers 404
// and the hooks refuse to act. Inlined at build time for the client bundle.
export const TRIGGER_ENABLED = process.env.NEXT_PUBLIC_DISABLE_TRIGGER !== "1";

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
