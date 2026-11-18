import { describe, expect, it } from "vitest";
import { UpstreamError } from "./cache";
import { cacheControl, cachedJson, failureResponse } from "./respond";

describe("cacheControl", () => {
  it("shares a fresh payload for the full TTL by default", () => {
    expect(cacheControl(15)).toBe("public, s-maxage=15, stale-while-revalidate=15");
  });

  it("shares a payload only for what is left of its TTL", () => {
    expect(cacheControl(60, false, 12.2)).toBe("public, s-maxage=13, stale-while-revalidate=13");
    expect(cacheControl(15, false, 0.3)).toBe("public, s-maxage=1, stale-while-revalidate=1");
    // Never longer than the route TTL, even when a part lives longer.
    expect(cacheControl(10, false, 3600)).toBe("public, s-maxage=10, stale-while-revalidate=10");
  });

  it("uses the short stale header for stale or expired payloads", () => {
    expect(cacheControl(60, true)).toBe("public, s-maxage=5");
    expect(cacheControl(60, false, 0)).toBe("public, s-maxage=5");
    expect(cacheControl(60, false, -30)).toBe("public, s-maxage=5");
    expect(cacheControl(3, true)).toBe("public, s-maxage=3");
  });
});

describe("cachedJson", () => {
  const now = 1_000_000;

  it("derives s-maxage from expiresAt and omits stale when fresh", async () => {
    const res = cachedJson({ a: 1 }, 15, false, now + 4_000, now);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=4, stale-while-revalidate=4");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("adds stale: true to the body and short headers when stale", async () => {
    const res = cachedJson({ a: 1 }, 15, true, now - 1_000, now);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=5");
    expect(await res.json()).toEqual({ a: 1, stale: true });
  });

  it("falls back to the full TTL without expiresAt", () => {
    expect(cachedJson({}, 60, false).headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=60"
    );
  });
});

describe("failureResponse", () => {
  it("maps upstream failures to 503 with Retry-After, keeping 404s", async () => {
    const res = failureResponse(new UpstreamError("busy", 503, 7), 15, "Prices");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(failureResponse(new Error("x"), 15, "Prices").headers.get("retry-after")).toBe("15");
    expect(failureResponse(new UpstreamError("nope", 404), 15, "Prices").status).toBe(404);
  });
});
