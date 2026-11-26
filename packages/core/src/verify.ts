import { canonicalize } from "./canonical.ts";
import { blake2b256, fromHex, toHex } from "./hash.ts";
import { MerkleTree, type Leaf } from "./merkle.ts";
import { parseCanonicalRules } from "./rules.ts";
import { snapshotPayloadBytes, verifySnapshotSignature, type SnapshotPayload } from "./snapshot.ts";

/** What `POST /snapshot` returns (enclave/chek-enclave/.../apps/chek/snapshot.rs). */
export interface SnapshotResponse {
  payload: SnapshotPayload;
  payload_bcs: string;
  signature: string;
  public_key: string;
  snapshot_json: string;
  posts_read: number;
  users_read: number;
  llm_calls: number;
}

export interface SnapshotEntrant { i: number; reply_id: string; author_id: string; handle: string; address: string; via: string; verdict: string }

export interface SnapshotDocument {
  v: number;
  campaign_id: string;
  post_id: string;
  post_author_id: string;
  linked: boolean;
  fetched_at: number;
  rules_hash: string;
  replies_seen: number;
  posts_read: number;
  users_read: number;
  entrants: SnapshotEntrant[];
  excluded: { reply_id: string; author_id: string; code: string; reason?: string }[];
  ai: null | { model: string; rubric_hash: string; judged: number };
}

export interface Check { name: string; pass: boolean }

const enc = new TextEncoder();

/**
 * The Verify page's checks on a snapshot (FR16, AC19), all recomputed in the browser:
 * signature by the enclave key, payload bytes, document hash, document ↔ payload fields and the
 * entrants' Merkle root. `publicKeyHex` should come from the on-chain Enclave object.
 */
export function verifySnapshot(publicKeyHex: string, payload: SnapshotPayload, signatureHex: string, documentText: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean) => checks.push({ name, pass });
  let sigOk = false;
  try {
    sigOk = verifySnapshotSignature(fromHex(publicKeyHex), payload, fromHex(signatureHex));
  } catch {
    sigOk = false;
  }
  add("signature by the enclave key", sigOk);
  add("snapshot_hash is Blake2b-256 of the document", toHex(blake2b256(enc.encode(documentText))) === payload.snapshot_hash);

  let doc: SnapshotDocument | null = null;
  try {
    doc = JSON.parse(documentText) as SnapshotDocument;
  } catch {
    // reported below
  }
  add("document is canonical JSON", doc !== null && canonicalize(doc) === documentText);
  if (!doc) return checks;
  add("document version 1", doc.v === 1);
  add(
    "document matches the signed payload",
    doc.campaign_id === payload.campaign_id &&
      doc.post_id === payload.post_id &&
      doc.post_author_id === payload.post_author_id &&
      doc.linked === payload.linked &&
      String(doc.fetched_at) === payload.fetched_at &&
      doc.rules_hash === payload.rules_hash &&
      doc.replies_seen === payload.replies_seen &&
      doc.entrants.length === payload.n,
  );
  add("entrants are indexed 0..n−1", doc.entrants.every((e, k) => e.i === k));
  let rootOk = false;
  try {
    const leaves: Leaf[] = doc.entrants.map((e) => ({ i: e.i, author_id: e.author_id, address: e.address }));
    rootOk = toHex(new MerkleTree(leaves).root) === payload.root;
  } catch {
    rootOk = false;
  }
  add("Merkle root of the entrants", rootOk);
  return checks;
}

/** A response is consistent when its BCS bytes are the payload's and every check passes. */
export function verifySnapshotResponse(r: SnapshotResponse, publicKeyHex = r.public_key): Check[] {
  return [
    { name: "payload_bcs encodes the payload", pass: toHex(snapshotPayloadBytes(r.payload)) === r.payload_bcs },
    ...verifySnapshot(publicKeyHex, r.payload, r.signature, r.snapshot_json),
  ];
}

/** The rules document on Walrus hashes to the committed rules_hash (MD5). */
export function verifyRules(rulesText: string, payload: SnapshotPayload): Check {
  const parsed = parseCanonicalRules(rulesText);
  return { name: "rules document hashes to rules_hash", pass: parsed.ok && toHex(parsed.hash) === payload.rules_hash };
}
