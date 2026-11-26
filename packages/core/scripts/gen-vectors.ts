/**
 * Generates fixtures/vectors.json: inputs and expected outputs that the TypeScript core, the Rust
 * enclave crate and the Move package must all reproduce byte for byte.
 */
import {
  blake2b256,
  canonicalize,
  canonicalRules,
  leafBytes,
  leafHash,
  MerkleTree,
  PADDING_LEAF,
  rulesHash,
  snapshotPayloadBytes,
  snapshotSigningBytes,
  toHex,
  type SnapshotPayload,
  type Leaf,
  type RulesV1,
} from "../src/index.ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { VECTORS_PATH, writeOrCheck } from "./vectors-lib.ts";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => toHex(b);

/** Deterministic pseudo-random leaf i, covering the full u64 range for author IDs. */
export function genLeaf(i: number): Leaf {
  const a = blake2b256(enc.encode(`chek-vector-address:${i}`));
  const b = blake2b256(enc.encode(`chek-vector-author:${i}`));
  let id = 0n;
  for (let k = 7; k >= 0; k--) id = (id << 8n) | BigInt(b[k]!);
  return { i, author_id: id.toString(), address: `0x${hex(a)}` };
}

const LEAF_COUNT = 200;
const leaves = Array.from({ length: LEAF_COUNT }, (_, i) => genLeaf(i));

const edgeLeaves: Leaf[] = [
  { i: 0, author_id: "0", address: `0x${"00".repeat(32)}` },
  { i: 4294967295, author_id: "18446744073709551615", address: `0x${"ff".repeat(32)}` },
  { i: 1, author_id: "1234567890123456789", address: `0x${"0123456789abcdef".repeat(4)}` },
];

const treeSizes = [0, 1, 2, 3, 5, 8, 13, LEAF_COUNT];
const trees = treeSizes.map((n) => {
  const t = new MerkleTree(leaves.slice(0, n));
  return {
    n,
    depth: t.depth,
    root: hex(t.root),
    proofs: Array.from({ length: n }, (_, i) => t.proof(i).map(hex)),
  };
});

const blakeInputs = ["", "00", "01", "616263", "00".repeat(64), "ff".repeat(129)];

const canonicalCases: { name: string; value: unknown }[] = [
  { name: "key order", value: { b: 1, a: 2, c: { z: null, y: [true, false] } } },
  { name: "integers", value: { zero: 0, neg: -5, max_safe: 9007199254740991, min_safe: -9007199254740991 } },
  { name: "empty containers", value: { a: [], o: {} } },
  { name: "escapes", value: { s: 'quote " backslash \\ newline \n tab \t cr \r bs \b ff \f ctl \u0001 \u001f del \u007f ls  ' } },
  { name: "non-ascii", value: { s: "Mystic Yeti ❄️ é ü 雪 😀" } },
  { name: "utf16 key order", value: { "ﬁ": 1, "😀": 2, "€": 3, a: 4, "": 5 } },
  { name: "nested arrays", value: [[1, [2, [3]]], "x", null] },
];

const baseDraw: RulesV1 = {
  v: 1,
  platform: "x",
  mode: "draw",
  entry: "reply",
  direct_replies_only: false,
  min_account_age_days: 30,
  min_followers: 10,
  required_text: ["#MysticYeti"],
  require_media: false,
  exclude_author_ids: ["1490000000000000000", "44196397"],
  exclude_post_author: true,
  rubric: null,
};

const baseJudged: RulesV1 = {
  ...baseDraw,
  mode: "judged",
  require_media: true,
  required_text: [],
  rubric: { prompt: "Pass if the image shows a hand-drawn yeti. Fail otherwise.", model: "claude-sonnet-5-5" },
};

const c = (v: unknown) => canonicalize(v);
const mut = (patch: Record<string, unknown>) => c({ ...baseDraw, ...patch });
const drop = (key: string) => {
  const o: Record<string, unknown> = { ...baseDraw };
  delete o[key];
  return c(o);
};

const validRules: { name: string; rules: RulesV1 }[] = [
  { name: "draw", rules: baseDraw },
  { name: "judged", rules: baseJudged },
  {
    name: "draw, all limits at maximum",
    rules: {
      ...baseDraw,
      direct_replies_only: true,
      min_account_age_days: 3650,
      min_followers: 1_000_000,
      required_text: ["a", "b", "c", "d", "é".repeat(100)],
      exclude_author_ids: [...Array.from({ length: 49 }, (_, k) => String(1000 + k)), "18446744073709551615"],
    },
  },
  { name: "judged, 2000-code-point prompt", rules: { ...baseJudged, rubric: { prompt: "😀".repeat(2000), model: "m" } } },
  // U+0085 (NEL) is whitespace in Rust but not in JavaScript's trim(): it must count as text.
  { name: "draw, NEL is not blank", rules: { ...baseDraw, required_text: ["\u0085"] } },
  { name: "draw, no filters", rules: { ...baseDraw, min_account_age_days: 0, min_followers: 0, required_text: [], exclude_author_ids: [] } },
];

const invalidRules: { name: string; text: string }[] = [
  { name: "whitespace", text: JSON.stringify(baseDraw, null, 2) },
  { name: "key order", text: JSON.stringify(baseDraw) },
  { name: "duplicate key", text: mut({}).replace('{"direct_replies_only"', '{"v":1,"direct_replies_only"') },
  { name: "not json", text: "{" },
  { name: "array", text: "[]" },
  { name: "unknown field", text: mut({ platform_extra: 1 }) },
  { name: "missing field", text: drop("require_media") },
  { name: "v 2", text: mut({ v: 2 }) },
  { name: "telegram", text: mut({ platform: "telegram" }) },
  { name: "entry quote", text: mut({ entry: "quote" }) },
  { name: "mode unknown", text: mut({ mode: "ranked" }) },
  { name: "judged without rubric", text: mut({ mode: "judged" }) },
  { name: "draw with rubric", text: mut({ rubric: { model: "m", prompt: "p" } }) },
  { name: "rubric extra key", text: c({ ...baseJudged, rubric: { model: "m", prompt: "p", temperature: 0 } }) },
  { name: "prompt 2001 code points", text: c({ ...baseJudged, rubric: { model: "m", prompt: "😀".repeat(2001) } }) },
  { name: "blank prompt", text: c({ ...baseJudged, rubric: { model: "m", prompt: "   " } }) },
  { name: "account age too high", text: mut({ min_account_age_days: 3651 }) },
  { name: "negative followers", text: mut({ min_followers: -1 }) },
  { name: "fractional followers", text: mut({}).replace('"min_followers":10', '"min_followers":10.5') },
  { name: "followers as string", text: mut({ min_followers: "10" }) },
  { name: "six required texts", text: mut({ required_text: ["a", "b", "c", "d", "e", "f"] }) },
  { name: "blank required text", text: mut({ required_text: [" "] }) },
  // U+FEFF is trimmed by JavaScript but is not Unicode White_Space: it must count as blank.
  { name: "BOM-only required text", text: mut({ required_text: ["\uFEFF\u00a0\u3000"] }) },
  { name: "required text 101 chars", text: mut({ required_text: ["x".repeat(101)] }) },
  { name: "author id as number", text: mut({ exclude_author_ids: [44196397] }) },
  { name: "author id leading zero", text: mut({ exclude_author_ids: ["044196397"] }) },
  { name: "author id above u64", text: mut({ exclude_author_ids: ["18446744073709551616"] }) },
  { name: "duplicate author id", text: mut({ exclude_author_ids: ["7", "7"] }) },
  { name: "51 author ids", text: mut({ exclude_author_ids: Array.from({ length: 51 }, (_, k) => String(k + 1)) }) },
  { name: "exclude_post_author false", text: mut({ exclude_post_author: false }) },
  { name: "direct_replies_only as number", text: mut({ direct_replies_only: 0 }) },
];

// Test-only enclave key: the same seed as Nautilus's own enclave.move test (0x07 repeated 32 times).
const TEST_ENCLAVE_SEED = new Uint8Array(32).fill(7);

const payloadBase: SnapshotPayload = {
  campaign_id: `0x${"c0ffee".padEnd(64, "0")}`,
  post_id: "1994000000000000000",
  rules_hash: hex(rulesHash(baseDraw)),
  opened_at: "1764200000000",
  closes_at: "1764800000000",
  mode: 0,
  k: 3,
  max_entrants: 5000,
  max_judged: 1000,
  max_replies_read: 20000,
  fetched_at: "1764800600000",
  n: 200,
  replies_seen: 312,
  root: trees.find((t) => t.n === LEAF_COUNT)!.root,
  snapshot_hash: hex(blake2b256(enc.encode("snapshot document bytes"))),
  linked: true,
  post_author_id: "44196397",
  request_counter: "1",
};

const payloads: { name: string; payload: SnapshotPayload }[] = [
  { name: "draw, 200 entrants, linked", payload: payloadBase },
  {
    name: "judged, no entrants, unlinked",
    payload: {
      ...payloadBase,
      rules_hash: hex(rulesHash(baseJudged)),
      mode: 1,
      k: 100,
      n: 0,
      replies_seen: 0,
      root: hex(PADDING_LEAF),
      linked: false,
      request_counter: "18446744073709551615",
    },
  },
];

const vectors = {
  version: 1,
  about:
    "Shared Chek encoding vectors. Generated by packages/core/scripts/gen-vectors.ts; TypeScript, Rust (enclave/chek-enclave/src/chek-core) and Move (move/chek) tests must reproduce every value.",
  blake2b256: blakeInputs.map((h) => ({ input: h, hash: hex(blake2b256(Uint8Array.from(Buffer.from(h, "hex")))) })),
  padding_leaf: hex(PADDING_LEAF),
  canonical: canonicalCases.map(({ name, value }) => {
    const text = canonicalize(value);
    return { name, value, canonical: text, hash: hex(blake2b256(enc.encode(text))) };
  }),
  rules: [
    ...validRules.map(({ name, rules }) => ({ name, text: canonicalRules(rules), valid: true, hash: hex(rulesHash(rules)) })),
    ...invalidRules.map(({ name, text }) => ({ name, text, valid: false, hash: null })),
  ],
  leaves: [...edgeLeaves, ...leaves].map((l) => ({ ...l, bcs: hex(leafBytes(l)), hash: hex(leafHash(l)) })),
  trees,
  enclave_test_key: {
    seed: hex(TEST_ENCLAVE_SEED),
    public_key: hex(ed25519.getPublicKey(TEST_ENCLAVE_SEED)),
  },
  snapshot_payloads: payloads.map(({ name, payload }) => ({
    name,
    payload,
    payload_bcs: hex(snapshotPayloadBytes(payload)),
    signing_bytes: hex(snapshotSigningBytes(payload)),
    signature: hex(ed25519.sign(snapshotSigningBytes(payload), TEST_ENCLAVE_SEED)),
  })),
};

writeOrCheck(VECTORS_PATH, `${JSON.stringify(vectors, null, 2)}\n`);
