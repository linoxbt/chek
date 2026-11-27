import { Transaction } from "@mysten/sui/transactions";
import { fromHex, MerkleTree, type SnapshotDocument, type SnapshotPayload } from "@chek/core";
import type { Campaign } from "./campaign.ts";
import { BATCH } from "./plan.ts";

export const CLOCK = "0x6";
export const RANDOM = "0x8";

const enc = new TextEncoder();
const bytes = (hex: string) => Array.from(fromHex(hex));

export interface Ids {
  packageId: string;
  /** The registered `Enclave<CHEK>` object whose key signs snapshots. */
  enclaveId: string;
}

const target = (ids: Ids, module: string, fn: string) => `${ids.packageId}::${module}::${fn}` as const;

/** commit_snapshot(campaign, enclave, snapshot::new(…), signature, blob_id, clock). */
export function commitTx(ids: Ids, c: Campaign, p: SnapshotPayload, signatureHex: string, blobId: string): Transaction {
  const tx = new Transaction();
  const payload = tx.moveCall({
    target: target(ids, "snapshot", "new"),
    arguments: [
      tx.pure.id(p.campaign_id),
      tx.pure.u64(p.post_id),
      tx.pure.vector("u8", bytes(p.rules_hash)),
      tx.pure.u64(p.opened_at),
      tx.pure.u64(p.closes_at),
      tx.pure.u8(p.mode),
      tx.pure.u16(p.k),
      tx.pure.u32(p.max_entrants),
      tx.pure.u32(p.max_judged),
      tx.pure.u32(p.max_replies_read),
      tx.pure.u64(p.fetched_at),
      tx.pure.u32(p.n),
      tx.pure.u32(p.replies_seen),
      tx.pure.vector("u8", bytes(p.root)),
      tx.pure.vector("u8", bytes(p.snapshot_hash)),
      tx.pure.bool(p.linked),
      tx.pure.u64(p.post_author_id),
      tx.pure.u64(p.request_counter),
    ],
  });
  tx.moveCall({
    target: target(ids, "campaign", "commit_snapshot"),
    typeArguments: [c.coinType],
    arguments: [
      tx.object(c.id),
      tx.object(ids.enclaveId),
      payload,
      tx.pure.vector("u8", bytes(signatureHex)),
      tx.pure.vector("u8", Array.from(enc.encode(blobId))),
      tx.object(CLOCK),
    ],
  });
  return tx;
}

export function expireTx(ids: Ids, c: Campaign): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: target(ids, "campaign", "expire"), typeArguments: [c.coinType], arguments: [tx.object(c.id), tx.object(CLOCK)] });
  return tx;
}

/** `draw` is a private entry function; Sui only allows TransferObjects/MergeCoins after it. */
export function drawTx(ids: Ids, c: Campaign): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: target(ids, "campaign", "draw"), typeArguments: [c.coinType], arguments: [tx.object(c.id), tx.object(RANDOM)] });
  return tx;
}

/** Pays `ranks` with Merkle proofs built from the committed snapshot document. */
export function distributeTx(ids: Ids, c: Campaign, doc: SnapshotDocument, ranks: number[]): Transaction {
  const leaves = doc.entrants.map((e) => ({ i: e.i, author_id: e.author_id, address: e.address }));
  const tree = new MerkleTree(leaves);
  const tx = new Transaction();
  for (const rank of ranks) {
    const i = c.winners[rank];
    if (i === undefined) throw new Error(`rank ${rank} has no winner`);
    const e = doc.entrants[i];
    if (!e || e.i !== i) throw new Error(`entrant ${i} missing from the snapshot document`);
    const proof = tx.pure.vector("vector<u8>", tree.proof(i).map((p) => Array.from(p)));
    const common = [tx.object(c.id), tx.pure.u16(rank), tx.pure.u32(i), tx.pure.u64(e.author_id), tx.pure.address(e.address), proof];
    if (c.prizeType) {
      tx.moveCall({ target: target(ids, "campaign", "distribute_object"), typeArguments: [c.coinType, c.prizeType], arguments: common });
    } else {
      tx.moveCall({ target: target(ids, "campaign", "distribute_coin"), typeArguments: [c.coinType], arguments: common });
    }
  }
  return tx;
}

export function reclaimTx(ids: Ids, c: Campaign): Transaction {
  const tx = new Transaction();
  if (c.prizeType) {
    tx.moveCall({
      target: target(ids, "campaign", "reclaim_unused_objects"),
      typeArguments: [c.coinType, c.prizeType],
      arguments: [tx.object(c.id), tx.pure.u16(BATCH)],
    });
  } else {
    tx.moveCall({ target: target(ids, "campaign", "reclaim_unused"), typeArguments: [c.coinType], arguments: [tx.object(c.id)] });
  }
  return tx;
}

export function refundObjectsTx(ids: Ids, c: Campaign): Transaction {
  if (!c.prizeType) throw new Error("refund_objects needs an object prize type");
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "campaign", "refund_objects"),
    typeArguments: [c.coinType, c.prizeType],
    arguments: [tx.object(c.id), tx.pure.u16(BATCH)],
  });
  return tx;
}
