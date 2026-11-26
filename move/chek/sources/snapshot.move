/// The enclave-signed snapshot payload (spec section 12). BCS field order here is the order
/// `packages/core/src/snapshot.ts` encodes and the enclave signs.
module chek::snapshot;

use chek::enclave_app::CHEK;
use enclave::enclave::{Self, Enclave};

const SNAPSHOT_INTENT: u8 = 1;

public struct SnapshotPayload has copy, drop {
    campaign_id: ID,
    post_id: u64,
    rules_hash: vector<u8>,
    opened_at: u64,
    closes_at: u64,
    mode: u8,
    k: u16,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
    fetched_at: u64,
    n: u32,
    replies_seen: u32,
    root: vector<u8>,
    snapshot_hash: vector<u8>,
    linked: bool,
    post_author_id: u64,
    request_counter: u64,
}

/// Built in the commit transaction from the fields the enclave returned.
public fun new(
    campaign_id: ID,
    post_id: u64,
    rules_hash: vector<u8>,
    opened_at: u64,
    closes_at: u64,
    mode: u8,
    k: u16,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
    fetched_at: u64,
    n: u32,
    replies_seen: u32,
    root: vector<u8>,
    snapshot_hash: vector<u8>,
    linked: bool,
    post_author_id: u64,
    request_counter: u64,
): SnapshotPayload {
    SnapshotPayload {
        campaign_id,
        post_id,
        rules_hash,
        opened_at,
        closes_at,
        mode,
        k,
        max_entrants,
        max_judged,
        max_replies_read,
        fetched_at,
        n,
        replies_seen,
        root,
        snapshot_hash,
        linked,
        post_author_id,
        request_counter,
    }
}

/// True when `signature` is the enclave's Ed25519 signature over
/// BCS(IntentMessage { intent: 1, timestamp_ms: fetched_at, payload }).
public fun verify_signature(
    enclave: &Enclave<CHEK>,
    payload: &SnapshotPayload,
    signature: &vector<u8>,
): bool {
    enclave::verify_signature(enclave, SNAPSHOT_INTENT, payload.fetched_at, *payload, signature)
}

public fun campaign_id(p: &SnapshotPayload): ID { p.campaign_id }

public fun post_id(p: &SnapshotPayload): u64 { p.post_id }

public fun rules_hash(p: &SnapshotPayload): vector<u8> { p.rules_hash }

public fun opened_at(p: &SnapshotPayload): u64 { p.opened_at }

public fun closes_at(p: &SnapshotPayload): u64 { p.closes_at }

public fun mode(p: &SnapshotPayload): u8 { p.mode }

public fun k(p: &SnapshotPayload): u16 { p.k }

public fun max_entrants(p: &SnapshotPayload): u32 { p.max_entrants }

public fun max_judged(p: &SnapshotPayload): u32 { p.max_judged }

public fun max_replies_read(p: &SnapshotPayload): u32 { p.max_replies_read }

public fun fetched_at(p: &SnapshotPayload): u64 { p.fetched_at }

public fun n(p: &SnapshotPayload): u32 { p.n }

public fun replies_seen(p: &SnapshotPayload): u32 { p.replies_seen }

public fun root(p: &SnapshotPayload): vector<u8> { p.root }

public fun snapshot_hash(p: &SnapshotPayload): vector<u8> { p.snapshot_hash }

public fun linked(p: &SnapshotPayload): bool { p.linked }

public fun post_author_id(p: &SnapshotPayload): u64 { p.post_author_id }

public fun request_counter(p: &SnapshotPayload): u64 { p.request_counter }
