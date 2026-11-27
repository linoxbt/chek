/** Fakes for runner tests, built around fixtures/snapshot-e2e.json (a real Rust enclave snapshot). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Transaction } from "@mysten/sui/transactions";
import { blake2b256, toHex, type SnapshotResponse } from "@chek/core";
import { PRIZE_COIN, Status, type Campaign } from "@chek/core";
import { EnclaveError, TxFailed, type Alerts, type BlobStore, type Chain, type Enclave, type SnapshotRequest } from "../src/ports.ts";

export const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/snapshot-e2e.json"), "utf8")) as {
  request: SnapshotRequest;
  response: SnapshotResponse;
};

export const PKG = "0x" + "ab".repeat(32);
export const ENCLAVE = "0x" + "e1".repeat(32);
export const RULES_BLOB = "rules-blob-1";
const enc = new TextEncoder();

export function campaign(over: Partial<Campaign> = {}): Campaign {
  const r = fixture.request;
  return {
    id: r.campaign_id,
    coinType: "0x2::sui::SUI",
    organizer: "0x" + "0a".repeat(32),
    mode: r.mode,
    status: Status.OPEN,
    k: r.k,
    createdAt: r.opened_at - 60_000,
    closesAt: r.closes_at,
    rulesBlob: RULES_BLOB,
    rulesHash: toHex(blake2b256(enc.encode(r.rules_json))),
    postId: r.post_id,
    openedAt: r.opened_at,
    prizeKind: PRIZE_COIN,
    prizeType: null,
    pool: 300n,
    deposited: 0,
    perWinner: 0n,
    remainder: 0n,
    unusedPending: false,
    maxEntrants: r.max_entrants,
    maxJudged: r.max_judged,
    maxRepliesRead: r.max_replies_read,
    enclaveVersion: 0,
    snapshot: null,
    winners: [],
    paid: [],
    ...over,
  };
}

interface Call {
  target: string;
  typeArguments: string[];
}

/** Move calls in a transaction, read without a network (Transaction#getData). */
export function calls(tx: Transaction): Call[] {
  return tx
    .getData()
    .commands.filter((c) => c.$kind === "MoveCall")
    .map((c) => {
      const m = c.MoveCall!;
      return { target: `${m.package}::${m.module}::${m.function}`, typeArguments: m.typeArguments };
    });
}

/** A chain that applies each Move call's effect to one campaign, like the contract would. */
export class FakeChain implements Chain {
  executed: Call[][] = [];
  failNext: TxFailed | null = null;
  enclaveKey = fixture.response.public_key;
  enclaveVersion = 0;
  constructor(public c: Campaign) {}

  async newCampaigns(cursor: string | null) {
    return cursor ? { ids: [], cursor } : { ids: [this.c.id], cursor: "c1" };
  }
  async campaign() {
    return structuredClone(this.c);
  }
  async enclave() {
    return { publicKey: this.enclaveKey, configVersion: this.enclaveVersion };
  }
  async objectsLeft() {
    return false;
  }
  async execute(tx: Transaction) {
    const cs = calls(tx);
    this.executed.push(cs);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    for (const call of cs) {
      const fn = call.target.split("::").pop();
      const p = fixture.response.payload;
      if (fn === "commit_snapshot") {
        this.c.status = p.n === 0 ? Status.SETTLED : Status.COMMITTED;
        this.c.snapshot = { enclaveId: ENCLAVE, fetchedAt: Number(p.fetched_at), n: p.n, repliesSeen: p.replies_seen,
          root: p.root, snapshotHash: p.snapshot_hash, blobId: "snap-blob-1", linked: p.linked, postAuthorId: p.post_author_id };
      } else if (fn === "draw") {
        const k = Math.min(this.c.k, this.c.snapshot!.n);
        this.c.status = Status.DRAWN;
        this.c.winners = Array.from({ length: k }, (_, r) => k - 1 - r);
        this.c.paid = this.c.winners.map(() => false);
        this.c.perWinner = this.c.pool / BigInt(k);
        this.c.remainder = this.c.pool - this.c.perWinner * BigInt(k);
        this.c.unusedPending = this.c.remainder > 0n;
      } else if (fn === "distribute_coin") {
        const r = this.c.paid.indexOf(false);
        this.c.paid[r] = true;
      } else if (fn === "reclaim_unused") {
        this.c.unusedPending = false;
      } else if (fn === "expire") {
        this.c.status = Status.EXPIRED;
      }
      if (this.c.status === Status.DRAWN && this.c.paid.every(Boolean) && !this.c.unusedPending) this.c.status = Status.SETTLED;
    }
    return `digest-${this.executed.length}`;
  }
}

export class FakeEnclave implements Enclave {
  requests: SnapshotRequest[] = [];
  respond: () => SnapshotResponse = () => structuredClone(fixture.response);
  error: EnclaveError | null = null;
  async snapshot(req: SnapshotRequest) {
    this.requests.push(req);
    if (this.error) throw this.error;
    return this.respond();
  }
}

export class MemoryBlobs implements BlobStore {
  blobs = new Map<string, Uint8Array>([[RULES_BLOB, enc.encode(fixture.request.rules_json)]]);
  corruptReads = false;
  async put(data: Uint8Array) {
    const id = "snap-blob-1";
    this.blobs.set(id, data);
    return id;
  }
  async get(id: string) {
    const b = this.blobs.get(id);
    if (!b) throw new Error(`no blob ${id}`);
    return this.corruptReads && id !== RULES_BLOB ? b.slice(1) : b;
  }
}

export class CapturedAlerts implements Alerts {
  messages: string[] = [];
  async send(m: string) {
    this.messages.push(m);
  }
}
