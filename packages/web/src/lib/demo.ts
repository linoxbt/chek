/**
 * Demo data: the snapshot the Rust enclave pipeline produced in its tests
 * (fixtures/snapshot-e2e.json), as a settled Judged Draw. Used with no PACKAGE_ID set, for
 * tests, screenshots and the demo video.
 */
import fixture from "../../../../fixtures/snapshot-e2e.json";
import { blake2b256, PRIZE_COIN, Status, toHex, type Campaign } from "@chek/core";
import type { EnclaveConfigInfo, History, Reader } from "./reader.ts";

const enc = new TextEncoder();
const r = fixture.request;
const p = fixture.response.payload;
export const DEMO_RULES_BLOB = "demo-rules";
export const DEMO_SNAPSHOT_BLOB = "demo-snapshot";
export const DEMO_ENCLAVE = "0x" + "e1".repeat(32);
const PCRS: [string, string, string] = ["11".repeat(48), "22".repeat(48), "33".repeat(48)];

const settled: Campaign = {
  id: r.campaign_id,
  coinType: "0x2::sui::SUI",
  organizer: "0x" + "0a".repeat(32),
  mode: r.mode,
  status: Status.SETTLED,
  k: r.k,
  createdAt: r.opened_at - 60_000,
  closesAt: r.closes_at,
  rulesBlob: DEMO_RULES_BLOB,
  rulesHash: toHex(blake2b256(enc.encode(r.rules_json))),
  postId: r.post_id,
  openedAt: r.opened_at,
  prizeKind: PRIZE_COIN,
  prizeType: null,
  pool: 0n,
  deposited: 0,
  perWinner: 150_000_000_000n,
  remainder: 0n,
  unusedPending: false,
  maxEntrants: r.max_entrants,
  maxJudged: r.max_judged,
  maxRepliesRead: r.max_replies_read,
  enclaveVersion: 0,
  snapshot: {
    enclaveId: DEMO_ENCLAVE,
    fetchedAt: Number(p.fetched_at),
    n: p.n,
    repliesSeen: p.replies_seen,
    root: p.root,
    snapshotHash: p.snapshot_hash,
    blobId: DEMO_SNAPSHOT_BLOB,
    linked: p.linked,
    postAuthorId: p.post_author_id,
  },
  winners: [1, 0],
  paid: [true, true],
};

const open: Campaign = { ...settled, id: "0x" + "be".repeat(32), status: Status.OPEN, createdAt: Date.now() - 22 * 3600_000, openedAt: Date.now() - 21 * 3600_000, closesAt: Date.now() + 3 * 3600_000, snapshot: null, winners: [], paid: [], pool: 300_000_000_000n };

const draft: Campaign = { ...open, id: "0x" + "d4".repeat(32), status: Status.DRAFT, postId: "0", openedAt: 0, createdAt: Date.now() - 5 * 60_000 };
const all = [draft, open, settled];

export class DemoReader implements Reader {
  campaigns = async () => all;
  async campaign(id: string) {
    const c = all.find((x) => x.id === id);
    if (!c) throw new Error("No giveaway with that ID");
    return c;
  }
  organizerCaps = async () => new Map([[draft.id, "0x" + "ca".repeat(32)], [open.id, "0x" + "cb".repeat(32)]]);
  feeMist = async () => 0n;
  enclaveConfig = async (): Promise<EnclaveConfigInfo> => ({ id: "0x" + "ec".repeat(32), name: "chek-enclave", version: 0, pcrs: PCRS });
  enclave = async () => ({ publicKey: fixture.response.public_key, configVersion: 0 });
  async history(): Promise<History> {
    const doc = JSON.parse(fixture.response.snapshot_json) as { entrants: { address: string }[] };
    return {
      committedDigest: "DemoCommit111",
      drawnDigest: "DemoDraw222",
      payouts: settled.winners.map((i, rank) => ({ rank, to: doc.entrants[i]!.address, amount: "150000000000", objectId: null, digest: `DemoPay${rank}` })),
    };
  }
  async blob(id: string) {
    if (id === DEMO_RULES_BLOB) return enc.encode(r.rules_json);
    if (id === DEMO_SNAPSHOT_BLOB) return enc.encode(fixture.response.snapshot_json);
    throw new Error(`no blob ${id}`);
  }
}
