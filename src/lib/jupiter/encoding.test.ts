import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { base64ToBytes, bytesToBase58, bytesToBase64 } from "./encoding";

describe("bytesToBase58", () => {
  it("matches known vectors", () => {
    expect(bytesToBase58(new Uint8Array())).toBe("");
    expect(bytesToBase58(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(bytesToBase58(new Uint8Array([0, 0, 0x28, 0x7f, 0xb4, 0xcd]))).toBe("11233QC4");
    expect(bytesToBase58(new Uint8Array([0]))).toBe("1");
    expect(bytesToBase58(new Uint8Array([57]))).toBe("z");
    expect(bytesToBase58(new Uint8Array([58]))).toBe("21");
  });

  it("matches @solana/web3.js for 32-byte keys", () => {
    expect(bytesToBase58(new Uint8Array(32))).toBe(PublicKey.default.toBase58());
    for (let i = 0; i < 20; i++) {
      const pk = Keypair.generate().publicKey;
      expect(bytesToBase58(pk.toBytes())).toBe(pk.toBase58());
    }
  });

  it("encodes a 64-byte signature to 87-88 chars", () => {
    const sig = new Uint8Array(64).fill(255);
    const s = bytesToBase58(sig);
    expect(s.length).toBeGreaterThanOrEqual(87);
    expect(s.length).toBeLessThanOrEqual(88);
    expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)).toBe(true);
  });
});

describe("base64 helpers", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
