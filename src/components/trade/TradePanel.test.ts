import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TokenInfo } from "@/lib/tokens/types";

// TRIGGER_MODE is read from NEXT_PUBLIC_DISABLE_TRIGGER when the config module
// loads, so each test stubs the env, resets modules and imports afresh.

const swap = vi.hoisted(() => ({ inFlight: undefined as unknown }));

vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => ({ publicKey: null }) }));
vi.mock("@/store/useSettingsStore", () => ({ useSettingsStore: { persist: { rehydrate: () => {} } } }));
vi.mock("@/store/usePendingSwapStore", () => ({ useSwapInFlight: () => swap.inFlight }));
vi.mock("./MarketOrderForm", () => ({ MarketOrderForm: () => "market-form" }));
vi.mock("./trigger", () => ({
  LimitOrderForm: () => "limit-form",
  DcaForm: () => "dca-form",
  isStableToken: () => false,
}));

const BASE: TokenInfo = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 };

async function render(flag: string): Promise<string> {
  vi.stubEnv("NEXT_PUBLIC_DISABLE_TRIGGER", flag);
  const { TradePanel } = await import("./TradePanel");
  return renderToStaticMarkup(createElement(TradePanel, { base: BASE }));
}

/** The opening tag of the tab button with id `order-tab-<id>`. */
function tab(html: string, id: string): string {
  const m = html.match(new RegExp(`<button[^>]*id="order-tab-${id}"[^>]*>`));
  if (!m) throw new Error(`tab ${id} not rendered`);
  return m[0];
}

beforeEach(() => {
  vi.resetModules();
  swap.inFlight = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TradePanel order tabs and the Trigger kill switch", () => {
  it("on: every tab is enabled and there is no kill-switch note", async () => {
    const html = await render("");
    for (const id of ["market", "limit", "dca"]) expect(tab(html, id)).not.toContain('disabled=""');
    expect(html).not.toContain("turned off");
    expect(html).not.toContain("jup.ag");
    expect(html).toContain("market-form");
  });

  it("new-orders-off: Limit / DCA stay enabled (the forms show the paused note)", async () => {
    const html = await render("1");
    const { TRIGGER_MODE } = await import("@/lib/jupiter/trigger/config");
    expect(TRIGGER_MODE).toBe("new-orders-off");
    for (const id of ["market", "limit", "dca"]) expect(tab(html, id)).not.toContain('disabled=""');
    expect(html).not.toContain("turned off");
    expect(html).not.toContain("jup.ag");
  });

  it("off: Limit / DCA are locked and the note links to jup.ag in a new tab", async () => {
    const html = await render("all");
    // Imported after render() so the config module is loaded with the stub.
    const { JUPITER_APP_URL, TRIGGER_MODE, TRIGGER_OFF_MESSAGE } = await import("@/lib/jupiter/trigger/config");
    expect(TRIGGER_MODE).toBe("off");
    expect(tab(html, "market")).not.toContain('disabled=""');
    for (const id of ["limit", "dca"]) {
      expect(tab(html, id)).toContain('disabled=""');
      expect(tab(html, id)).toContain('title="Turned off here"');
    }
    expect(html).not.toMatch(/temporarily unavailable/i);
    expect(html).toContain(`Limit orders and DCA are turned off here. ${TRIGGER_OFF_MESSAGE}`);
    const link = html.match(/<a [^>]*>/)?.[0] ?? "";
    expect(link).toContain(`href="${JUPITER_APP_URL}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(html).toContain("market-form");
  });

  it("a running market swap locks the Limit / DCA tabs", async () => {
    swap.inFlight = { id: "swap-1" };
    const html = await render("");
    expect(tab(html, "market")).not.toContain('disabled=""');
    for (const id of ["limit", "dca"]) {
      expect(tab(html, id)).toContain('disabled=""');
      expect(tab(html, id)).toContain('title="Wait for the market order to finish"');
    }
  });
});
