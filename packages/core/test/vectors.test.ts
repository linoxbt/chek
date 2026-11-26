import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blake2b256,
  canonicalize,
  fromHex,
  leafBytes,
  leafHash,
  MerkleTree,
  PADDING_LEAF,
  parseCanonicalRules,
  toHex,
  verifyProof,
  type Leaf,
} from "../src/index.ts";

interface Vectors {
  blake2b256: { input: string; hash: string }[];
  padding_leaf: string;
  canonical: { name: string; value: unknown; canonical: string; hash: string }[];
  rules: { name: string; text: string; valid: boolean; hash: string | null }[];
  leaves: (Leaf & { bcs: string; hash: string })[];
  trees: { n: number; depth: number; root: string; proofs: string[][] }[];
}

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/vectors.json"), "utf8")) as Vectors;
const enc = new TextEncoder();
// Leaves for trees are the generated sequence that follows the three edge leaves.
const seq = vectors.leaves.slice(3);

describe("blake2b256", () => {
  it("matches the published Blake2b-256 digest of the empty string", () => {
    expect(toHex(blake2b256(new Uint8Array()))).toBe("0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8");
  });
  it.each(vectors.blake2b256)("input $input", ({ input, hash }) => {
    expect(toHex(blake2b256(fromHex(input)))).toBe(hash);
  });
  it("padding leaf is Blake2b-256(0x00)", () => {
    expect(toHex(PADDING_LEAF)).toBe(vectors.padding_leaf);
  });
});

describe("canonical JSON", () => {
  it.each(vectors.canonical)("$name", ({ value, canonical, hash }) => {
    expect(canonicalize(value)).toBe(canonical);
    expect(toHex(blake2b256(enc.encode(canonical)))).toBe(hash);
  });
  it("refuses values that have no single canonical form across languages", () => {
    expect(() => canonicalize(1.5)).toThrow();
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(2 ** 53)).toThrow();
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize("\ud800")).toThrow();
    expect(() => canonicalize(new Date(0))).toThrow();
  });
});

describe("rules documents", () => {
  it.each(vectors.rules)("$name", ({ text, valid, hash }) => {
    const r = parseCanonicalRules(text);
    expect(r.ok).toBe(valid);
    if (r.ok) expect(toHex(r.hash)).toBe(hash);
  });
});

describe("leaves", () => {
  it.each(vectors.leaves.slice(0, 20))("leaf $i / $author_id", (l) => {
    expect(toHex(leafBytes(l))).toBe(l.bcs);
    expect(toHex(leafHash(l))).toBe(l.hash);
  });
  it("BCS layout is u32 LE ‖ u64 LE ‖ 32 address bytes", () => {
    const l = vectors.leaves[2]!;
    const manual = new Uint8Array(44);
    const dv = new DataView(manual.buffer);
    dv.setUint32(0, l.i, true);
    dv.setBigUint64(4, BigInt(l.author_id), true);
    manual.set(fromHex(l.address), 12);
    expect(toHex(leafBytes(l))).toBe(toHex(manual));
  });
  it("rejects addresses that are not 0x + 64 lowercase hex", () => {
    expect(() => leafBytes({ i: 0, author_id: "1", address: `0x${"A".repeat(64)}` })).toThrow();
    expect(() => leafBytes({ i: 0, author_id: "1", address: `0x${"a".repeat(63)}` })).toThrow();
  });
  it("all 203 leaves match", () => {
    for (const l of vectors.leaves) expect(toHex(leafHash(l))).toBe(l.hash);
  });
});

describe("merkle tree", () => {
  it.each(vectors.trees)("n = $n", ({ n, depth, root, proofs }) => {
    const t = new MerkleTree(seq.slice(0, n));
    expect(t.depth).toBe(depth);
    expect(toHex(t.root)).toBe(root);
    for (let i = 0; i < n; i++) {
      expect(t.proof(i).map(toHex)).toEqual(proofs[i]);
      expect(verifyProof(t.root, seq[i]!, t.proof(i))).toBe(true);
    }
  });

  it("depth stays at or below 13 for 5 000 entrants", () => {
    let d = 0;
    while (2 ** d < 5000) d++;
    expect(d).toBe(13);
  });

  const t = new MerkleTree(seq.slice(0, 13));
  const leaf = seq[5]!;
  const proof = t.proof(5);

  it("rejects a proof for another index", () => {
    expect(verifyProof(t.root, { ...leaf, i: 4 }, proof)).toBe(false);
    expect(verifyProof(t.root, leaf, t.proof(4))).toBe(false);
  });
  it("rejects a changed address or author", () => {
    expect(verifyProof(t.root, { ...leaf, address: seq[6]!.address }, proof)).toBe(false);
    expect(verifyProof(t.root, { ...leaf, author_id: "1" }, proof)).toBe(false);
  });
  it("rejects a tampered, shortened or lengthened proof", () => {
    const bad = proof.map((p) => p.slice());
    bad[1]![0]! ^= 1;
    expect(verifyProof(t.root, leaf, bad)).toBe(false);
    expect(verifyProof(t.root, leaf, proof.slice(0, -1))).toBe(false);
    expect(verifyProof(t.root, leaf, [...proof, PADDING_LEAF])).toBe(false);
  });
  it("rejects an index beyond the tree even when the low bits match", () => {
    expect(verifyProof(t.root, { ...leaf, i: 5 + 16 }, proof)).toBe(false);
  });
  it("refuses out-of-order leaves and out-of-range proofs", () => {
    expect(() => new MerkleTree([seq[1]!, seq[0]!])).toThrow();
    expect(() => t.proof(13)).toThrow();
  });
  it("a single entrant's root is its leaf hash; an empty tree's root is the padding leaf", () => {
    expect(toHex(new MerkleTree(seq.slice(0, 1)).root)).toBe(toHex(leafHash(seq[0]!)));
    expect(toHex(new MerkleTree([]).root)).toBe(toHex(PADDING_LEAF));
  });
});
