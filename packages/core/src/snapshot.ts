import { bcs } from "@mysten/bcs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { SNAPSHOT_INTENT } from "./constants.ts";
import { fromHex } from "./hash.ts";

/**
 * The payload the enclave signs and `chek::campaign::commit_snapshot` checks. Field order is the
 * Move struct `chek::snapshot::SnapshotPayload`; BCS encodes fields in declaration order.
 */
export interface SnapshotPayload {
  /** Campaign object ID, 0x + 64 hex. */
  campaign_id: string;
  post_id: string;
  /** 32 bytes, hex. */
  rules_hash: string;
  opened_at: string;
  closes_at: string;
  mode: number;
  k: number;
  max_entrants: number;
  max_judged: number;
  max_replies_read: number;
  fetched_at: string;
  n: number;
  replies_seen: number;
  /** Merkle root, 32 bytes, hex. */
  root: string;
  /** Blake2b-256 of the snapshot document bytes, hex. */
  snapshot_hash: string;
  linked: boolean;
  post_author_id: string;
  request_counter: string;
}

const Bytes32 = bcs.fixedArray(32, bcs.u8());

export const SnapshotPayloadBcs = bcs.struct("SnapshotPayload", {
  campaign_id: Bytes32,
  post_id: bcs.u64(),
  rules_hash: bcs.vector(bcs.u8()),
  opened_at: bcs.u64(),
  closes_at: bcs.u64(),
  mode: bcs.u8(),
  k: bcs.u16(),
  max_entrants: bcs.u32(),
  max_judged: bcs.u32(),
  max_replies_read: bcs.u32(),
  fetched_at: bcs.u64(),
  n: bcs.u32(),
  replies_seen: bcs.u32(),
  root: bcs.vector(bcs.u8()),
  snapshot_hash: bcs.vector(bcs.u8()),
  linked: bcs.bool(),
  post_author_id: bcs.u64(),
  request_counter: bcs.u64(),
});

/** Nautilus `enclave::IntentMessage<SnapshotPayload>`. */
export const SnapshotIntentBcs = bcs.struct("IntentMessage", {
  intent: bcs.u8(),
  timestamp_ms: bcs.u64(),
  payload: SnapshotPayloadBcs,
});

function toBcsInput(p: SnapshotPayload) {
  return {
    ...p,
    campaign_id: Array.from(fromHex(p.campaign_id)),
    rules_hash: Array.from(fromHex(p.rules_hash)),
    root: Array.from(fromHex(p.root)),
    snapshot_hash: Array.from(fromHex(p.snapshot_hash)),
  };
}

export function snapshotPayloadBytes(p: SnapshotPayload): Uint8Array {
  return SnapshotPayloadBcs.serialize(toBcsInput(p)).toBytes();
}

/** The exact bytes the enclave signs: BCS of IntentMessage { intent: 1, timestamp_ms: fetched_at, payload }. */
export function snapshotSigningBytes(p: SnapshotPayload): Uint8Array {
  return SnapshotIntentBcs.serialize({
    intent: SNAPSHOT_INTENT,
    timestamp_ms: p.fetched_at,
    payload: toBcsInput(p),
  }).toBytes();
}

/** What `enclave::verify_signature` checks on-chain, for the Verify page. */
export function verifySnapshotSignature(publicKey: Uint8Array, p: SnapshotPayload, signature: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, snapshotSigningBytes(p), publicKey);
  } catch {
    return false;
  }
}
