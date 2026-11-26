//! Entrant Merkle tree, identical to `packages/core/src/merkle.ts` and `chek::merkle` in Move.
//!
//! leaf = Blake2b-256(0x00 ‖ BCS(Leaf { i: u32, author_id: u64, address: address }))
//! node = Blake2b-256(0x01 ‖ left ‖ right), leaves padded to a power of two with Blake2b-256(0x00).

use crate::hash::blake2b256;
use serde::Serialize;

pub const PADDING_LEAF_INPUT: [u8; 1] = [0x00];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Leaf {
    pub i: u32,
    pub author_id: u64,
    /// A Sui address: serialised by BCS as 32 bytes with no length prefix.
    pub address: [u8; 32],
}

pub fn leaf_bytes(leaf: &Leaf) -> Vec<u8> {
    bcs::to_bytes(leaf).expect("Leaf always serialises")
}

pub fn leaf_hash(leaf: &Leaf) -> [u8; 32] {
    let mut data = Vec::with_capacity(45);
    data.push(0x00);
    data.extend(leaf_bytes(leaf));
    blake2b256(&data)
}

pub fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut data = [0u8; 65];
    data[0] = 0x01;
    data[1..33].copy_from_slice(left);
    data[33..].copy_from_slice(right);
    blake2b256(&data)
}

pub struct MerkleTree {
    levels: Vec<Vec<[u8; 32]>>,
    n: usize,
}

impl MerkleTree {
    /// Builds the tree. Leaves must be in index order (`leaves[k].i == k`).
    pub fn new(leaves: &[Leaf]) -> Result<Self, String> {
        for (k, l) in leaves.iter().enumerate() {
            if l.i as usize != k {
                return Err(format!(
                    "leaf {k} has index {}; leaves must be in index order",
                    l.i
                ));
            }
        }
        let width = leaves.len().max(1).next_power_of_two();
        let pad = blake2b256(&PADDING_LEAF_INPUT);
        let mut level: Vec<[u8; 32]> = leaves.iter().map(leaf_hash).collect();
        level.resize(width, pad);
        let mut levels = vec![level];
        while levels.last().expect("at least one level").len() > 1 {
            let cur = levels.last().expect("at least one level");
            let next = cur.chunks(2).map(|p| node_hash(&p[0], &p[1])).collect();
            levels.push(next);
        }
        Ok(Self {
            levels,
            n: leaves.len(),
        })
    }

    pub fn root(&self) -> [u8; 32] {
        self.levels.last().expect("at least one level")[0]
    }

    pub fn depth(&self) -> usize {
        self.levels.len() - 1
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    pub fn proof(&self, i: usize) -> Option<Vec<[u8; 32]>> {
        if i >= self.n {
            return None;
        }
        let mut idx = i;
        let mut out = Vec::with_capacity(self.depth());
        for level in &self.levels[..self.depth()] {
            out.push(level[idx ^ 1]);
            idx >>= 1;
        }
        Some(out)
    }
}

/// Mirrors `chek::merkle::verify`: bit k of the index picks the side at level k, and the
/// index must be fully consumed by the proof.
pub fn verify_proof(root: &[u8; 32], leaf: &Leaf, proof: &[[u8; 32]]) -> bool {
    if proof.len() > 32 {
        return false;
    }
    let mut cur = leaf_hash(leaf);
    let mut idx = u64::from(leaf.i);
    for sib in proof {
        cur = if idx & 1 == 0 {
            node_hash(&cur, sib)
        } else {
            node_hash(sib, &cur)
        };
        idx >>= 1;
    }
    idx == 0 && &cur == root
}
