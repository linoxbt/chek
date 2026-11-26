/// Entrant Merkle tree verification (spec section 8), byte-compatible with packages/core and
/// enclave/chek-core:
///   leaf = blake2b256(0x00 ‖ bcs(Leaf { i: u32, author_id: u64, address }))
///   node = blake2b256(0x01 ‖ left ‖ right)
/// Bit k of the leaf index says whether the running hash is the left (0) or right (1) child at
/// level k, and the proof must consume every bit of the index.
module chek::merkle;

use std::bcs;
use sui::hash::blake2b256;

/// Longest proof accepted: enough for any u32 index.
const MAX_DEPTH: u64 = 32;

/// BCS layout of an entrant leaf. Field names don't affect BCS; `addr` stands in for the spec's
/// `address`, which is a reserved word in Move.
public struct Leaf has copy, drop {
    i: u32,
    author_id: u64,
    addr: address,
}

public fun leaf_hash(i: u32, author_id: u64, addr: address): vector<u8> {
    let mut data = vector[0u8];
    data.append(bcs::to_bytes(&Leaf { i, author_id, addr }));
    blake2b256(&data)
}

public fun node_hash(left: &vector<u8>, right: &vector<u8>): vector<u8> {
    let mut data = vector[1u8];
    data.append(*left);
    data.append(*right);
    blake2b256(&data)
}

/// True when `proof` links leaf (i, author_id, addr) to `root`.
public fun verify(
    root: &vector<u8>,
    i: u32,
    author_id: u64,
    addr: address,
    proof: &vector<vector<u8>>,
): bool {
    let depth = proof.length();
    if (depth > MAX_DEPTH) return false;
    let mut cur = leaf_hash(i, author_id, addr);
    let mut idx = (i as u64);
    let mut k = 0;
    while (k < depth) {
        let sibling = &proof[k];
        if (sibling.length() != 32) return false;
        cur = if ((idx & 1) == 0) node_hash(&cur, sibling) else node_hash(sibling, &cur);
        idx = idx >> 1;
        k = k + 1;
    };
    (idx == 0) && (&cur == root)
}
