import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireUpstream,
  cached,
  cachedMany,
  cooldownRemainingMs,
  peek,
  resetServerCache,
  setCooldown,
  UpstreamError,
} from "./cache";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  resetServerCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cached", () => {
  it("serves a fresh value without calling the fetcher again", async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    expect(await cached("k", fetcher, { ttlMs: 10_000 })).toMatchObject({ value: 1, stale: false });
    vi.advanceTimersByTime(9_999);
    expect(await cached("k", fetcher, { ttlMs: 10_000 })).toMatchObject({ value: 1, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has passed", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await cached("k", fetcher, { ttlMs: 10_000 });
    vi.advanceTimersByTime(10_000);
    expect((await cached("k", fetcher, { ttlMs: 10_000 })).value).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight fetch between concurrent callers (single-flight)", async () => {
    let resolve!: (v: number) => void;
    const fetcher = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const calls = [1, 2, 3, 4, 5].map(() => cached("k", fetcher, { ttlMs: 1000 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(42);
    const results = await Promise.all(calls);
    expect(results.map((r) => r.value)).toEqual([42, 42, 42, 42, 42]);
  });

  it("keeps keys independent", async () => {
    const a = await cached("a", async () => "A", { ttlMs: 1000 });
    const b = await cached("b", async () => "B", { ttlMs: 1000 });
    expect([a.value, b.value]).toEqual(["A", "B"]);
  });

  it("serves the last good value marked stale when a refresh fails", async () => {
    await cached("k", async () => "good", { ttlMs: 1000 });
    const fetchedAt = Date.now();
    vi.advanceTimersByTime(5_000);
    const res = await cached("k", async () => Promise.reject(new Error("down")), { ttlMs: 1000 });
    expect(res).toEqual({ value: "good", stale: true, fetchedAt, expiresAt: fetchedAt + 1000 });
  });

  it("rethrows once the last good value is older than maxStaleMs", async () => {
    await cached("k", async () => "good", { ttlMs: 1000, maxStaleMs: 60_000 });
    vi.advanceTimersByTime(60_001);
    await expect(
      cached("k", async () => Promise.reject(new Error("down")), { ttlMs: 1000, maxStaleMs: 60_000 })
    ).rejects.toThrow("down");
  });

  it("rethrows when nothing was ever cached, and does not cache the failure", async () => {
    await expect(cached("k", async () => Promise.reject(new Error("down")), { ttlMs: 1000 })).rejects.toThrow(
      "down"
    );
    expect((await cached("k", async () => "ok", { ttlMs: 1000 })).value).toBe("ok");
  });

  it("supports a per-value TTL (e.g. short-lived negative results)", async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const opts = { ttlMs: (v: string | null) => (v ? 60_000 : 1_000) };
    await cached("k", fetcher, opts);
    vi.advanceTimersByTime(1_000);
    await cached("k", fetcher, opts);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts least recently used entries beyond the size bound", async () => {
    await cached("first", async () => 1, { ttlMs: 3_600_000 });
    for (let i = 0; i < 1000; i++) await cached(`k${i}`, async () => i, { ttlMs: 3_600_000 });
    const fetcher = vi.fn().mockResolvedValue(2);
    await cached("first", fetcher, { ttlMs: 3_600_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const kept = vi.fn().mockResolvedValue(-1);
    expect((await cached("k999", kept, { ttlMs: 3_600_000 })).value).toBe(999);
    expect(kept).not.toHaveBeenCalled();
  });
});

describe("cachedMany", () => {
  const key = (id: string) => `m:${id}`;
  const ttl = { ttlMs: () => 10_000 };
  /** A fetcher that answers `id -> id.toUpperCase()` for every id except "none". */
  const upper = () =>
    vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.filter((id) => id !== "none").map((id) => [id, id.toUpperCase()]))
    );
  const values = (r: { results: Map<string, { value: unknown }> }) =>
    Object.fromEntries([...r.results].map(([id, v]) => [id, v.value]));

  it("fetches only the missing ids, in one call, and caches each id separately", async () => {
    const fetcher = upper();
    const first = await cachedMany(["a", "b"], key, fetcher, ttl);
    expect(values(first)).toEqual({ a: "A", b: "B" });
    expect(first.error).toBeUndefined();
    const second = await cachedMany(["b", "c", "c"], key, fetcher, ttl);
    expect(values(second)).toEqual({ b: "B", c: "C" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toEqual(["c"]);
    // Shares entries with differently shaped requests: no call at all.
    await cachedMany(["c", "a"], key, fetcher, ttl);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("caches ids the upstream omits as null, with a per-value TTL", async () => {
    const fetcher = upper();
    const opts = { ttlMs: (v: string | null) => (v ? 60_000 : 1_000) };
    const res = await cachedMany(["a", "none"], key, fetcher, opts);
    expect(values(res)).toEqual({ a: "A", none: null });
    expect(res.results.get("none")?.expiresAt).toBe(Date.now() + 1_000);
    vi.advanceTimersByTime(1_000);
    await cachedMany(["a", "none"], key, fetcher, opts);
    expect(fetcher.mock.calls[1][0]).toEqual(["none"]);
  });

  it("on failure serves recent ids stale, leaves the rest out and reports the error", async () => {
    await cachedMany(["a"], key, upper(), ttl);
    const fetchedAt = Date.now();
    vi.advanceTimersByTime(20_000);
    const down = vi.fn(async () => Promise.reject(new UpstreamError("down", 503, 7)));
    const res = await cachedMany(["a", "b"], key, down, ttl);
    expect(down).toHaveBeenCalledTimes(1);
    expect(res.results.get("a")).toEqual({ value: "A", stale: true, fetchedAt, expiresAt: fetchedAt + 10_000 });
    expect(res.results.has("b")).toBe(false);
    expect((res.error as UpstreamError).retryAfterS).toBe(7);
  });

  it("sets error when every id was served stale", async () => {
    await cachedMany(["a"], key, upper(), ttl);
    vi.advanceTimersByTime(20_000);
    const res = await cachedMany(["a"], key, async () => Promise.reject(new Error("x")), ttl);
    expect(res.results.get("a")?.stale).toBe(true);
    expect(res.error).toBeDefined();
  });

  it("treats a synchronous fetcher throw like a failed fetch", async () => {
    const res = await cachedMany(
      ["a"],
      key,
      () => {
        throw new Error("sync");
      },
      ttl
    );
    expect(res.results.size).toBe(0);
    expect((res.error as Error).message).toBe("sync");
  });

  it("shares in-flight ids between concurrent requests (single-flight)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetcher = vi.fn(async (ids: string[]) => {
      await gate;
      return Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
    });
    const reqs = [
      cachedMany(["a", "b"], key, fetcher, ttl),
      cachedMany(["a", "b"], key, fetcher, ttl),
      cachedMany(["b", "c"], key, fetcher, ttl),
    ];
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([["a", "b"], ["c"]]);
    release();
    const [r1, r2, r3] = await Promise.all(reqs);
    expect(values(r1)).toEqual({ a: "A", b: "B" });
    expect(values(r2)).toEqual({ a: "A", b: "B" });
    expect(values(r3)).toEqual({ b: "B", c: "C" });
  });

  it("refreshes aging requested ids and due companions only when a call is made anyway", async () => {
    const fetcher = upper();
    const opts = { ...ttl, companions: ["x", "y"] };
    // No call needed: companions are not fetched on their own.
    await cachedMany(["a"], key, fetcher, ttl);
    await cachedMany(["a"], key, fetcher, opts);
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6_000); // "a" is fresh but past half its TTL
    const res = await cachedMany(["a", "b"], key, fetcher, opts);
    expect(fetcher.mock.calls[1][0]).toEqual(["b", "a", "x", "y"]);
    // Companions are cached but not returned.
    expect([...res.results.keys()].sort()).toEqual(["a", "b"]);
    await cachedMany(["x", "y"], key, fetcher, ttl);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a fresh value fresh when a ride-along refresh fails", async () => {
    await cachedMany(["a"], key, upper(), ttl);
    vi.advanceTimersByTime(6_000);
    const down = vi.fn<(ids: string[]) => Promise<Record<string, string>>>(async () =>
      Promise.reject(new Error("down"))
    );
    const res = await cachedMany(["a", "b"], key, down, ttl);
    expect(down.mock.calls[0][0]).toEqual(["b", "a"]);
    expect(res.results.get("a")?.stale).toBe(false);
    expect(res.results.has("b")).toBe(false);
  });

  it("trims ride-along ids to maxBatch but never the missing ones", async () => {
    const fetcher = upper();
    await cachedMany(["a", "b", "c"], key, fetcher, { ...ttl, maxBatch: 2, companions: ["x", "y"] });
    expect(fetcher.mock.calls[0][0]).toEqual(["a", "b", "c"]);
    vi.advanceTimersByTime(10_000);
    await cachedMany(["a"], key, fetcher, { ...ttl, maxBatch: 2, companions: ["x", "y"] });
    expect(fetcher.mock.calls[1][0]).toEqual(["a", "x"]);
  });
});

describe("peek", () => {
  it("returns a value within maxAge, flagged stale after its TTL, without fetching", async () => {
    expect(peek("k", 60_000)).toBeNull();
    await cached("k", async () => [1], { ttlMs: 1_000 });
    expect(peek("k", 60_000)).toMatchObject({ value: [1], stale: false });
    vi.advanceTimersByTime(2_000);
    expect(peek("k", 60_000)).toMatchObject({ value: [1], stale: true });
    vi.advanceTimersByTime(60_000);
    expect(peek("k", 60_000)).toBeNull();
  });
});

describe("upstream cooldown and budget", () => {
  it("blocks calls during a cooldown and reports the remaining time", () => {
    setCooldown("gt", 60);
    expect(cooldownRemainingMs("gt")).toBe(60_000);
    expect(() => acquireUpstream("gt", 10)).toThrow(UpstreamError);
    try {
      acquireUpstream("gt", 10);
    } catch (err) {
      expect((err as UpstreamError).status).toBe(503);
      expect((err as UpstreamError).retryAfterS).toBe(60);
    }
    vi.advanceTimersByTime(60_000);
    expect(cooldownRemainingMs("gt")).toBe(0);
    expect(() => acquireUpstream("gt", 10)).not.toThrow();
  });

  it("never shortens an existing cooldown", () => {
    setCooldown("gt", 60);
    setCooldown("gt", 5);
    expect(cooldownRemainingMs("gt")).toBe(60_000);
  });

  it("enforces a sliding per-minute budget per upstream", () => {
    for (let i = 0; i < 3; i++) acquireUpstream("jup", 3);
    expect(() => acquireUpstream("jup", 3)).toThrow(/budget/);
    expect(() => acquireUpstream("other", 3)).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(() => acquireUpstream("jup", 3)).not.toThrow();
  });

  it("lets cached() fall back to stale data while an upstream cools down", async () => {
    const fetcher = vi.fn(async () => {
      acquireUpstream("gt", 10);
      return "fresh";
    });
    await cached("k", fetcher, { ttlMs: 1000 });
    setCooldown("gt", 60);
    vi.advanceTimersByTime(2_000);
    expect(await cached("k", fetcher, { ttlMs: 1000 })).toMatchObject({ value: "fresh", stale: true });
  });
});
