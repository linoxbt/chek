import type { Transaction } from "@mysten/sui/transactions";
import type { SnapshotResponse } from "@chek/core";
import type { Campaign } from "./campaign.ts";

/** What the runner needs from Sui. */
export interface Chain {
  /** IDs of campaigns created since `cursor` (from `Created` events), and the next cursor. */
  newCampaigns(cursor: string | null): Promise<{ ids: string[]; cursor: string | null }>;
  campaign(id: string): Promise<Campaign>;
  enclave(id: string): Promise<{ publicKey: string; configVersion: number }>;
  /** Whether any object prize is still held in the campaign. */
  objectsLeft(campaignId: string): Promise<boolean>;
  /** Signs, executes and waits; resolves to the digest or throws a `TxFailed`. */
  execute(tx: Transaction): Promise<string>;
}

export class TxFailed extends Error {
  constructor(
    message: string,
    /** Move abort code, when the failure was an abort. */
    readonly abortCode?: number,
  ) {
    super(message);
  }
}

export class EnclaveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SnapshotRequest {
  campaign_id: string;
  post_id: string;
  opened_at: number;
  closes_at: number;
  mode: number;
  k: number;
  max_entrants: number;
  max_judged: number;
  max_replies_read: number;
  rules_json: string;
}

export interface Enclave {
  snapshot(req: SnapshotRequest): Promise<SnapshotResponse>;
}

export interface BlobStore {
  /** Stores bytes; returns the Walrus blob ID. */
  put(data: Uint8Array): Promise<string>;
  get(blobId: string): Promise<Uint8Array>;
}

export interface Alerts {
  send(message: string): Promise<void>;
}
