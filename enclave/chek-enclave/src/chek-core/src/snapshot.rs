//! The snapshot document (Walrus) and the payload the enclave signs (spec sections 8 and 12).
//! Byte-compatible with `chek::snapshot::SnapshotPayload` in Move and
//! `packages/core/src/snapshot.ts`.

use crate::canonical::canonicalize;
use crate::filter::Outcome;
use crate::hash::blake2b256;
use crate::merkle::{Leaf, MerkleTree};
use serde::Serialize;
use serde_json::{json, Value};

/// Intent scope of a signed snapshot payload.
pub const SNAPSHOT_INTENT: u8 = 1;
pub const SNAPSHOT_VERSION: u64 = 1;

/// Field order is BCS order and must match the Move struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SnapshotPayload {
    pub campaign_id: [u8; 32],
    pub post_id: u64,
    pub rules_hash: Vec<u8>,
    pub opened_at: u64,
    pub closes_at: u64,
    pub mode: u8,
    pub k: u16,
    pub max_entrants: u32,
    pub max_judged: u32,
    pub max_replies_read: u32,
    pub fetched_at: u64,
    pub n: u32,
    pub replies_seen: u32,
    pub root: Vec<u8>,
    pub snapshot_hash: Vec<u8>,
    pub linked: bool,
    pub post_author_id: u64,
    pub request_counter: u64,
}

#[derive(Serialize)]
struct IntentMessage<'a> {
    intent: u8,
    timestamp_ms: u64,
    payload: &'a SnapshotPayload,
}

impl SnapshotPayload {
    pub fn bcs(&self) -> Vec<u8> {
        bcs::to_bytes(self).expect("payload always serialises")
    }

    /// BCS(IntentMessage { intent: 1, timestamp_ms: fetched_at, payload }): what the enclave signs
    /// and `enclave::verify_signature` checks.
    pub fn signing_bytes(&self) -> Vec<u8> {
        bcs::to_bytes(&IntentMessage {
            intent: SNAPSHOT_INTENT,
            timestamp_ms: self.fetched_at,
            payload: self,
        })
        .expect("intent message always serialises")
    }

    /// The JSON shape `packages/core` reads: 64-bit integers as decimal strings, bytes as hex.
    pub fn to_json(&self) -> Value {
        json!({
            "campaign_id": format!("0x{}", hex::encode(self.campaign_id)),
            "post_id": self.post_id.to_string(),
            "rules_hash": hex::encode(&self.rules_hash),
            "opened_at": self.opened_at.to_string(),
            "closes_at": self.closes_at.to_string(),
            "mode": self.mode,
            "k": self.k,
            "max_entrants": self.max_entrants,
            "max_judged": self.max_judged,
            "max_replies_read": self.max_replies_read,
            "fetched_at": self.fetched_at.to_string(),
            "n": self.n,
            "replies_seen": self.replies_seen,
            "root": hex::encode(&self.root),
            "snapshot_hash": hex::encode(&self.snapshot_hash),
            "linked": self.linked,
            "post_author_id": self.post_author_id.to_string(),
            "request_counter": self.request_counter.to_string(),
        })
    }
}

/// Recorded with Judged Draw snapshots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiInfo {
    pub model: String,
    /// Blake2b-256 of the rubric prompt's UTF-8 bytes.
    pub rubric_hash: [u8; 32],
    pub judged: u32,
}

/// Everything the snapshot document records besides the filter's outcome.
#[derive(Debug, Clone)]
pub struct SnapshotFacts {
    pub campaign_id: [u8; 32],
    pub post_id: u64,
    pub post_author_id: u64,
    pub linked: bool,
    pub fetched_at: u64,
    pub rules_hash: [u8; 32],
    pub posts_read: u64,
    pub users_read: u64,
    pub ai: Option<AiInfo>,
}

/// The document uploaded to Walrus, its hash and the entrants' Merkle root.
#[derive(Debug, Clone)]
pub struct BuiltSnapshot {
    /// Canonical JSON (RFC 8785 subset); these exact bytes are uploaded.
    pub document: String,
    pub snapshot_hash: [u8; 32],
    pub root: [u8; 32],
    pub n: u32,
    pub replies_seen: u32,
}

pub fn build_snapshot(facts: &SnapshotFacts, outcome: &Outcome) -> BuiltSnapshot {
    let doc = json!({
        "v": SNAPSHOT_VERSION,
        "campaign_id": format!("0x{}", hex::encode(facts.campaign_id)),
        "post_id": facts.post_id.to_string(),
        "post_author_id": facts.post_author_id.to_string(),
        "linked": facts.linked,
        "fetched_at": facts.fetched_at,
        "rules_hash": hex::encode(facts.rules_hash),
        "replies_seen": outcome.replies_seen,
        "posts_read": facts.posts_read,
        "users_read": facts.users_read,
        "entrants": outcome.entrants,
        "excluded": outcome.excluded,
        "ai": facts.ai.as_ref().map(|a| json!({
            "model": a.model,
            "rubric_hash": hex::encode(a.rubric_hash),
            "judged": a.judged,
        })),
    });
    let document = canonicalize(&doc).expect("snapshot document holds only canonical values");
    let leaves: Vec<Leaf> = outcome
        .entrants
        .iter()
        .map(|e| Leaf {
            i: e.i,
            author_id: e.author_id,
            address: hex::decode(&e.address[2..])
                .expect("hex")
                .try_into()
                .expect("32 bytes"),
        })
        .collect();
    let tree = MerkleTree::new(&leaves).expect("entrants are indexed in order");
    BuiltSnapshot {
        snapshot_hash: blake2b256(document.as_bytes()),
        root: tree.root(),
        n: outcome.entrants.len() as u32,
        replies_seen: outcome.replies_seen,
        document,
    }
}
