import { describe, expect, it } from "vitest";
import { MAX_PRICE_IDS, parsePriceIds } from "./validate";
import { CURATED_MINTS } from "./curated";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

describe("parsePriceIds", () => {
  it("accepts 1..50 valid mints and dedupes", () => {
    expect(parsePriceIds([`${SOL},${JUP},${SOL}`])).toEqual({ ok: true, value: [SOL, JUP] });
    expect(parsePriceIds([` ${SOL} ,`])).toEqual({ ok: true, value: [SOL] });
  });

  it("rejects missing, repeated, empty, invalid and oversized input", () => {
    expect(parsePriceIds([]).ok).toBe(false);
    expect(parsePriceIds([SOL, JUP]).ok).toBe(false);
    expect(parsePriceIds([""]).ok).toBe(false);
    expect(parsePriceIds([",,"]).ok).toBe(false);
    expect(parsePriceIds([`${SOL},nope`]).ok).toBe(false);
    expect(parsePriceIds([Array(MAX_PRICE_IDS + 1).fill(SOL).join(",")]).ok).toBe(false);
    expect(parsePriceIds(["x".repeat(5000)]).ok).toBe(false);
  });

  it("accepts the whole curated list in one call", () => {
    expect(parsePriceIds([CURATED_MINTS.join(",")]).ok).toBe(true);
  });
});
