import { bcs } from "@mysten/bcs";
import { blake2b256, bytesEqual, concatBytes, fromHex } from "./hash.ts";

/**
 * Entrant Merkle tree (spec section 8).
 *   leaf = Blake2b-256(0x00 ‖ BCS(Leaf { i: u32, author_id: u64, address: address }))
 *   node = Blake2b-256(0x01 ‖ left ‖ right)
 * Leaves are in index order, padded to the next power of two with Blake2b-256(0x00).
 * A proof lists sibling hashes from the leaf upwards; bit k of i says whether the running hash is
 * the right (1) or left (0) child at level k. n = 0 gives the root of a single padding leaf.
 */

export interface Leaf {
  i: number;
  /** X user ID, a u64 as a decimal string. */
  author_id: string;
  /** Sui address, 0x + 64 lowercase hex. */
  address: string;
}

export const LeafBcs = bcs.struct("Leaf", {
  i: bcs.u32(),
  author_id: bcs.u64(),
  address: bcs.fixedArray(32, bcs.u8()),
});

const LEAF_TAG = Uint8Array.of(0x00);
const NODE_TAG = Uint8Array.of(0x01);
export const PADDING_LEAF = blake2b256(LEAF_TAG);

const ADDRESS = /^0x[0-9a-f]{64}$/;

export function leafBytes(leaf: Leaf): Uint8Array {
  if (!ADDRESS.test(leaf.address)) throw new Error(`address must be 0x + 64 lowercase hex: ${leaf.address}`);
  return LeafBcs.serialize({ i: leaf.i, author_id: leaf.author_id, address: Array.from(fromHex(leaf.address)) }).toBytes();
}

export function leafHash(leaf: Leaf): Uint8Array {
  return blake2b256(concatBytes(LEAF_TAG, leafBytes(leaf)));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return blake2b256(concatBytes(NODE_TAG, left, right));
}

export class MerkleTree {
  /** levels[0] = padded leaf hashes; last level = [root]. */
  readonly levels: Uint8Array[][];
  readonly n: number;

  constructor(leaves: Leaf[]) {
    leaves.forEach((l, idx) => {
      if (l.i !== idx) throw new Error(`leaf ${idx} has index ${l.i}; leaves must be in index order`);
    });
    this.n = leaves.length;
    let width = 1;
    while (width < leaves.length) width *= 2;
    const level: Uint8Array[] = leaves.map(leafHash);
    while (level.length < width) level.push(PADDING_LEAF);
    this.levels = [level];
    let cur = level;
    while (cur.length > 1) {
      const next: Uint8Array[] = [];
      for (let k = 0; k < cur.length; k += 2) next.push(nodeHash(cur[k]!, cur[k + 1]!));
      this.levels.push(next);
      cur = next;
    }
  }

  get root(): Uint8Array {
    return this.levels[this.levels.length - 1]![0]!;
  }

  get depth(): number {
    return this.levels.length - 1;
  }

  proof(i: number): Uint8Array[] {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) throw new Error(`index ${i} out of range 0..${this.n - 1}`);
    const out: Uint8Array[] = [];
    let idx = i;
    for (let lvl = 0; lvl < this.depth; lvl++) {
      out.push(this.levels[lvl]![idx ^ 1]!);
      idx >>= 1;
    }
    return out;
  }
}

/** Mirrors chek::merkle::verify in Move. */
export function verifyProof(root: Uint8Array, leaf: Leaf, proof: Uint8Array[]): boolean {
  if (proof.length > 32) return false;
  let cur = leafHash(leaf);
  let idx = leaf.i;
  for (const sib of proof) {
    if (sib.length !== 32) return false;
    cur = (idx & 1) === 0 ? nodeHash(cur, sib) : nodeHash(sib, cur);
    idx = Math.floor(idx / 2);
  }
  return idx === 0 && bytesEqual(cur, root);
}
