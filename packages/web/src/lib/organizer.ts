import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@chek/core";

export const CLOCK = "0x6";
const enc = new TextEncoder();

export interface ChainIds {
  packageId: string;
  configId: string;
  enclaveConfigId: string;
}

export interface CreateParams {
  mode: 0 | 1;
  k: number;
  closesAt: number;
  rulesBlob: string;
  rulesHash: string;
  feeMist: bigint;
  sender: string;
}

function create(tx: Transaction, ids: ChainIds, p: CreateParams, coinType: string, prizeKind: 0 | 1) {
  const [campaign, cap] = tx.moveCall({
    target: `${ids.packageId}::campaign::create`,
    typeArguments: [coinType],
    arguments: [
      tx.object(ids.configId),
      tx.object(ids.enclaveConfigId),
      coinWithBalance({ balance: p.feeMist }),
      tx.pure.u8(p.mode),
      tx.pure.u16(p.k),
      tx.pure.u64(p.closesAt),
      tx.pure.vector("u8", Array.from(enc.encode(p.rulesBlob))),
      tx.pure.vector("u8", Array.from(fromHex(p.rulesHash))),
      tx.pure.u8(prizeKind),
      tx.object(CLOCK),
    ],
  });
  return { campaign: campaign!, cap: cap! };
}

/** Create, fund and share in one transaction (one signature), then hand the cap to the organizer. */
export function createCoinGiveawayTx(ids: ChainIds, p: CreateParams, coinType: string, amount: bigint): Transaction {
  const tx = new Transaction();
  tx.setSender(p.sender);
  const { campaign, cap } = create(tx, ids, p, coinType, 0);
  tx.moveCall({
    target: `${ids.packageId}::campaign::fund_coin`,
    typeArguments: [coinType],
    arguments: [campaign, cap, coinWithBalance({ type: coinType, balance: amount })],
  });
  tx.moveCall({ target: `${ids.packageId}::campaign::share`, typeArguments: [coinType], arguments: [campaign] });
  tx.transferObjects([cap], p.sender);
  return tx;
}

/** Object prizes: one deposit per object, in rank order (slot r is rank r's prize). */
export function createObjectGiveawayTx(ids: ChainIds, p: CreateParams, prizeType: string, objectIds: string[]): Transaction {
  if (objectIds.length !== p.k) throw new Error(`deposit exactly ${p.k} objects`);
  const tx = new Transaction();
  tx.setSender(p.sender);
  const { campaign, cap } = create(tx, ids, p, "0x2::sui::SUI", 1);
  for (const id of objectIds) {
    tx.moveCall({
      target: `${ids.packageId}::campaign::deposit_object`,
      typeArguments: ["0x2::sui::SUI", prizeType],
      arguments: [campaign, cap, tx.object(id)],
    });
  }
  tx.moveCall({ target: `${ids.packageId}::campaign::share`, typeArguments: ["0x2::sui::SUI"], arguments: [campaign] });
  tx.transferObjects([cap], p.sender);
  return tx;
}

export function openTx(ids: ChainIds, campaignId: string, coinType: string, capId: string, postId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ids.packageId}::campaign::open`,
    typeArguments: [coinType],
    arguments: [tx.object(campaignId), tx.object(capId), tx.pure.u64(postId), tx.object(CLOCK)],
  });
  return tx;
}

export function cancelTx(ids: ChainIds, campaignId: string, coinType: string, capId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: `${ids.packageId}::campaign::cancel`, typeArguments: [coinType], arguments: [tx.object(campaignId), tx.object(capId)] });
  return tx;
}
