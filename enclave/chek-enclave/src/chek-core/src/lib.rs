//! Encoding shared by the Chek enclave. Every function here has a TypeScript twin in
//! `packages/core`, and both are checked against `fixtures/vectors.json`.

pub mod canonical;
pub mod filter;
pub mod hash;
pub mod json;
pub mod merkle;
pub mod rules;
pub mod snapshot;

pub use canonical::{canonicalize, CanonicalError};
pub use hash::blake2b256;
pub use merkle::{
    leaf_bytes, leaf_hash, node_hash, verify_proof, Leaf, MerkleTree, PADDING_LEAF_INPUT,
};
pub use rules::{parse_canonical_rules, validate_rules, Mode, Rubric, Rules};
