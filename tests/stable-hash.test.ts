import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, stableHash } from "@/lib/decision";

const sha = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

/** A realistic nested input, like the hashable part of a decision snapshot. */
function sample() {
  return {
    security: { id: "sec_1", ticker: "ACME", exchangeCode: "NYSE", cik: "0000123456" },
    inputs: {
      price: { value: 60.25, currency: "USD", date: "2025-03-03" },
      annual: Array.from({ length: 12 }, (_, i) => ({
        fiscalYear: 2014 + i,
        periodEnd: `${2014 + i}-12-31`,
        values: { revenue: 1_000_000_000 + i * 1_000, netIncome: 50_000_000 + i, eps: 2.5 + i / 100, dividendsPaid: i % 3 === 0 ? null : 1_000 },
      })),
    },
    rules: { D1: "PASS", D2: "FAIL", D3: "INSUFFICIENT_DATA" },
  };
}

describe("stableHash (SHA-256 over canonical JSON)", () => {
  it("is SHA-256 of the canonical serialization (known vector)", () => {
    expect(stableHash({ b: 2, a: [1, "x", null, true] })).toBe(sha('{"a":[1,"x",null,true],"b":2}'));
    expect(stableHash({ b: 2, a: [1] })).toMatch(/^sha256:[0-9a-f]{64}$/);
    // FIPS 180-2 test vector for "abc".
    expect(stableHash("abc")).toBe(sha('"abc"'));
    expect(createHash("sha256").update("abc").digest("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("unchanged inputs give identical hashes, regardless of key order or object identity", () => {
    expect(stableHash(sample())).toBe(stableHash(sample()));
    expect(stableHash(sample())).toBe(stableHash(JSON.parse(JSON.stringify(sample()))));
    expect(stableHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    const shared = { x: 1 };
    expect(stableHash({ p: shared, q: shared })).toBe(stableHash({ p: { x: 1 }, q: { x: 1 } }));
  });

  it("a change anywhere in the input changes the hash (every leaf of a nested input)", () => {
    const base = stableHash(sample());
    const seen = new Set<string>([base]);
    // Mutate every leaf one at a time; each must give a new, distinct hash.
    const leaves: Array<(o: ReturnType<typeof sample>) => void> = [
      (o) => (o.security.ticker = "ACMF"),
      (o) => (o.security.cik = "0000123457"),
      (o) => (o.inputs.price.value = 60.26),
      (o) => (o.inputs.price.currency = "EUR"),
      (o) => (o.inputs.price.date = "2025-03-04"),
      (o) => (o.rules.D3 = "PASS"),
    ];
    for (let y = 0; y < 12; y++) {
      leaves.push((o) => (o.inputs.annual[y].fiscalYear += 1));
      leaves.push((o) => (o.inputs.annual[y].values.revenue += 1));
      leaves.push((o) => (o.inputs.annual[y].values.netIncome -= 1));
      leaves.push((o) => (o.inputs.annual[y].values.eps += 0.000001));
      leaves.push((o) => (o.inputs.annual[y].values.dividendsPaid = o.inputs.annual[y].values.dividendsPaid === null ? 0 : null));
    }
    for (const mutate of leaves) {
      const o = sample();
      mutate(o);
      const h = stableHash(o);
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    }
    expect(seen.size).toBe(leaves.length + 1);
  });

  it("detects structural changes: added, removed, reordered array items, renamed keys", () => {
    const base = stableHash(sample());
    const added = sample() as Record<string, unknown>;
    added.extra = 0;
    const removed = sample();
    removed.inputs.annual.pop();
    const reordered = sample();
    reordered.inputs.annual.reverse();
    const renamed = { ...sample(), rulez: sample().rules } as Record<string, unknown>;
    delete renamed.rules;
    for (const v of [added, removed, reordered, renamed]) expect(stableHash(v)).not.toBe(base);
  });

  it("does not confuse values that JSON.stringify would collapse together", () => {
    const distinct = [null, 0, -1, "0", "", false, [], {}, [null], NaN, Infinity, -Infinity, "NaN", new Date("2025-01-01T00:00:00Z"), "2025-01-01T00:00:00.000Z", BigInt(1), "1"];
    const hashes = distinct.map((v) => stableHash({ v }));
    expect(new Set(hashes).size).toBe(distinct.length);
    // Previously two different Dates both serialized as {} and hashed the same.
    expect(stableHash({ d: new Date("2024-01-01") })).not.toBe(stableHash({ d: new Date("2025-01-01") }));
  });

  it("treats undefined object keys as absent (matching what is stored as JSON)", () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
    expect(stableHash({ a: 1, b: null })).not.toBe(stableHash({ a: 1 }));
  });

  it("is not a weak 32-bit hash: no collisions over many near-identical inputs", () => {
    const hashes = new Set<string>();
    const n = 50_000;
    for (let i = 0; i < n; i++) hashes.add(stableHash({ price: i / 100, ticker: "ACME" }));
    expect(hashes.size).toBe(n);
  });

  it("refuses inputs it cannot represent faithfully instead of silently dropping them", () => {
    expect(() => stableHash({ f: () => 1 })).toThrow(TypeError);
    expect(() => stableHash({ m: new Map([["a", 1]]) })).toThrow(TypeError);
    expect(() => stableHash({ s: new Set([1]) })).toThrow(TypeError);
    expect(() => stableHash({ d: new Date("not a date") })).toThrow(TypeError);
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    expect(() => stableHash(cyc)).toThrow(/circular/);
  });

  it("canonicalJson uses toJSON for value objects such as decimals", () => {
    const dec = { toJSON: () => "12.50" };
    expect(canonicalJson({ x: dec })).toBe('{"x":"12.50"}');
  });
});
