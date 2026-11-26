//! Checks this crate against fixtures/vectors.json, the same file the TypeScript and Move tests use.

use chek_core::*;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    blake2b256: Vec<HashCase>,
    padding_leaf: String,
    canonical: Vec<CanonicalCase>,
    rules: Vec<RulesCase>,
    leaves: Vec<LeafCase>,
    trees: Vec<TreeCase>,
}

#[derive(Deserialize)]
struct HashCase {
    input: String,
    hash: String,
}

#[derive(Deserialize)]
struct CanonicalCase {
    name: String,
    value: Value,
    canonical: String,
    hash: String,
}

#[derive(Deserialize)]
struct RulesCase {
    name: String,
    text: String,
    valid: bool,
    hash: Option<String>,
}

#[derive(Deserialize)]
struct LeafCase {
    i: u32,
    author_id: String,
    address: String,
    bcs: String,
    hash: String,
}

#[derive(Deserialize)]
struct TreeCase {
    n: usize,
    depth: usize,
    root: String,
    proofs: Vec<Vec<String>>,
}

fn vectors() -> Vectors {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../fixtures/vectors.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("read vectors"))
        .expect("parse vectors")
}

fn h32(s: &str) -> [u8; 32] {
    hex::decode(s.trim_start_matches("0x"))
        .expect("hex")
        .try_into()
        .expect("32 bytes")
}

fn leaf(c: &LeafCase) -> Leaf {
    Leaf {
        i: c.i,
        author_id: c.author_id.parse().expect("u64"),
        address: h32(&c.address),
    }
}

#[test]
fn blake2b256_matches() {
    let v = vectors();
    for c in &v.blake2b256 {
        assert_eq!(
            hex::encode(blake2b256(&hex::decode(&c.input).unwrap())),
            c.hash,
            "input {}",
            c.input
        );
    }
    assert_eq!(hex::encode(blake2b256(&PADDING_LEAF_INPUT)), v.padding_leaf);
}

#[test]
fn canonical_json_matches() {
    for c in vectors().canonical {
        let text = canonicalize(&c.value).unwrap_or_else(|e| panic!("{}: {e}", c.name));
        assert_eq!(text, c.canonical, "{}", c.name);
        assert_eq!(
            hex::encode(blake2b256(text.as_bytes())),
            c.hash,
            "{}",
            c.name
        );
    }
}

#[test]
fn rules_verdicts_and_hashes_match() {
    for c in vectors().rules {
        let got = parse_canonical_rules(&c.text);
        assert_eq!(got.is_ok(), c.valid, "{}: {:?}", c.name, got.as_ref().err());
        if let (Ok((_, hash)), Some(want)) = (got, c.hash) {
            assert_eq!(hex::encode(hash), want, "{}", c.name);
        }
    }
}

#[test]
fn leaves_match() {
    for c in vectors().leaves {
        let l = leaf(&c);
        assert_eq!(hex::encode(leaf_bytes(&l)), c.bcs, "leaf {}", c.i);
        assert_eq!(hex::encode(leaf_hash(&l)), c.hash, "leaf {}", c.i);
    }
}

#[test]
fn trees_and_proofs_match() {
    let v = vectors();
    let seq: Vec<Leaf> = v.leaves[3..].iter().map(leaf).collect();
    for t in &v.trees {
        let tree = MerkleTree::new(&seq[..t.n]).unwrap();
        assert_eq!(tree.depth(), t.depth, "n = {}", t.n);
        assert_eq!(hex::encode(tree.root()), t.root, "n = {}", t.n);
        for (i, (l, want)) in seq.iter().zip(&t.proofs).enumerate() {
            let proof = tree.proof(i).unwrap();
            let want: Vec<[u8; 32]> = want.iter().map(|p| h32(p)).collect();
            assert_eq!(proof, want, "n = {}, i = {i}", t.n);
            assert!(
                verify_proof(&tree.root(), l, &proof),
                "n = {}, i = {i}",
                t.n
            );
        }
        assert_eq!(t.proofs.len(), t.n);
        assert!(tree.proof(t.n).is_none());
    }
}

#[test]
fn bad_proofs_are_rejected() {
    let v = vectors();
    let seq: Vec<Leaf> = v.leaves[3..].iter().map(leaf).collect();
    let tree = MerkleTree::new(&seq[..13]).unwrap();
    let root = tree.root();
    let proof = tree.proof(5).unwrap();
    let l = seq[5];
    assert!(!verify_proof(&root, &Leaf { i: 4, ..l }, &proof));
    assert!(!verify_proof(&root, &l, &tree.proof(4).unwrap()));
    assert!(!verify_proof(&root, &Leaf { author_id: 1, ..l }, &proof));
    assert!(!verify_proof(&root, &Leaf { i: 21, ..l }, &proof));
    let mut tampered = proof.clone();
    tampered[1][0] ^= 1;
    assert!(!verify_proof(&root, &l, &tampered));
    assert!(!verify_proof(&root, &l, &proof[..proof.len() - 1]));
    assert!(MerkleTree::new(&[seq[1], seq[0]]).is_err());
}

#[test]
fn snapshot_payload_bcs_and_signing_bytes_match() {
    use chek_core::snapshot::SnapshotPayload;
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../fixtures/vectors.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    for c in v["snapshot_payloads"].as_array().unwrap() {
        let p = &c["payload"];
        let s = |k: &str| p[k].as_str().unwrap().to_owned();
        let n = |k: &str| p[k].as_u64().unwrap();
        let payload = SnapshotPayload {
            campaign_id: h32(&s("campaign_id")),
            post_id: s("post_id").parse().unwrap(),
            rules_hash: hex::decode(s("rules_hash")).unwrap(),
            opened_at: s("opened_at").parse().unwrap(),
            closes_at: s("closes_at").parse().unwrap(),
            mode: n("mode") as u8,
            k: n("k") as u16,
            max_entrants: n("max_entrants") as u32,
            max_judged: n("max_judged") as u32,
            max_replies_read: n("max_replies_read") as u32,
            fetched_at: s("fetched_at").parse().unwrap(),
            n: n("n") as u32,
            replies_seen: n("replies_seen") as u32,
            root: hex::decode(s("root")).unwrap(),
            snapshot_hash: hex::decode(s("snapshot_hash")).unwrap(),
            linked: p["linked"].as_bool().unwrap(),
            post_author_id: s("post_author_id").parse().unwrap(),
            request_counter: s("request_counter").parse().unwrap(),
        };
        let name = c["name"].as_str().unwrap();
        assert_eq!(hex::encode(payload.bcs()), c["payload_bcs"].as_str().unwrap(), "{name}");
        assert_eq!(hex::encode(payload.signing_bytes()), c["signing_bytes"].as_str().unwrap(), "{name}");
        assert_eq!(&payload.to_json(), p, "{name}: JSON shape");
    }
}
