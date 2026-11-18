import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairSwapHref } from "@/components/explore/pairSwapHref";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import { GET as getExplore } from "./explore/route";
import { GET as getMemes } from "./memes/route";

const fetchMock = vi.fn<typeof fetch>();

function rateLimited() {
  return Response.json({ error: "Rate limited" }, { status: 429 });
}

function pair(pairAddress: string, mint: string, volume: number) {
  return {
    chainId: "solana",
    pairAddress,
    baseToken: { address: mint, name: "Token", symbol: "TKN" },
    priceUsd: "1",
    volume: { h24: volume },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => rateLimited());
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  { name: "Memes", getFeed: getMemes },
  { name: "Explore", getFeed: getExplore },
])("$name feed", ({ getFeed }) => {
  it("surfaces an upstream outage when every search is rate limited", async () => {
    const response = await getFeed();

    expect(response.ok).toBe(false);
    expect(response.headers.get("Cache-Control") ?? "").not.toContain("public");
  });

  it("returns an empty feed when a successful search finds no pairs", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ pairs: [] }));

    const response = await getFeed();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pairs: [] });
  });

  it("surfaces an outage when the only successful status has an invalid payload", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Upstream unavailable" }));

    const response = await getFeed();

    expect(response.ok).toBe(false);
  });
});

it("keeps active Solana meme pairs from successful searches and sorts them by volume", async () => {
  const small = pair("small", USDC_MINT, 10);
  const large = pair("large", USDC_MINT, 50);
  fetchMock
    .mockResolvedValueOnce(Response.json({
      pairs: [
        small,
        { ...pair("other-chain", SOL_MINT, 100), chainId: "ethereum" },
        pair("no-volume", SOL_MINT, 0),
      ],
    }))
    .mockResolvedValueOnce(rateLimited())
    .mockResolvedValueOnce(Response.json({
      pairs: [small, large, { ...pair("unpriced", SOL_MINT, 20), priceUsd: null }],
    }));

  const response = await getMemes();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ pairs: [large, small] });
});

it("keeps the first Explore pair for each mint and links to that token", async () => {
  const first = pair("first", USDC_MINT, 10);
  const second = pair("second", SOL_MINT, 40);
  fetchMock
    .mockResolvedValueOnce(Response.json({ pairs: [first] }))
    .mockResolvedValueOnce(rateLimited())
    .mockResolvedValueOnce(Response.json({
      pairs: [pair("duplicate-mint", USDC_MINT, 100), second],
    }));

  const response = await getExplore();
  const { pairs } = await response.json();

  expect(response.status).toBe(200);
  expect(pairs).toEqual([first, second]);
  expect(pairSwapHref(pairs[0])).toBe(`/swap?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}`);
});
