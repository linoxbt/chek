import { bcs } from "@mysten/bcs";
import { toHex } from "@chek/core";

/** Status codes of chek::campaign. */
export const Status = { DRAFT: 0, OPEN: 1, COMMITTED: 2, DRAWN: 3, SETTLED: 4, EXPIRED: 5, CANCELLED: 6 } as const;
export const PRIZE_COIN = 0;
export const PRIZE_OBJECTS = 1;

const Address = bcs.fixedArray(32, bcs.u8()).transform({
  input: (hex: string) => Array.from(Buffer.from(hex.replace(/^0x/, "").padStart(64, "0"), "hex")),
  output: (bytes: number[]) => `0x${Buffer.from(bytes).toString("hex")}`,
});
const Bytes = bcs.vector(bcs.u8());

/** `std::type_name::TypeName { name: String }` */
const TypeName = bcs.struct("TypeName", { name: bcs.string() });

const SnapshotRef = bcs.struct("SnapshotRef", {
  enclave_id: Address,
  fetched_at: bcs.u64(),
  n: bcs.u32(),
  replies_seen: bcs.u32(),
  root: Bytes,
  snapshot_hash: Bytes,
  blob_id: Bytes,
  linked: bcs.bool(),
  post_author_id: bcs.u64(),
  request_counter: bcs.u64(),
});

/** BCS layout of `chek::campaign::Campaign<C>`, field for field (move/chek/sources/campaign.move). */
export const CampaignBcs = bcs.struct("Campaign", {
  id: Address,
  organizer: Address,
  mode: bcs.u8(),
  status: bcs.u8(),
  k: bcs.u16(),
  created_at: bcs.u64(),
  closes_at: bcs.u64(),
  rules_blob: Bytes,
  rules_hash: Bytes,
  post_id: bcs.u64(),
  opened_at: bcs.u64(),
  prize_kind: bcs.u8(),
  prize_type: bcs.option(TypeName),
  pool: bcs.struct("Balance", { value: bcs.u64() }),
  deposited: bcs.u16(),
  per_winner: bcs.u64(),
  remainder: bcs.u64(),
  unused_pending: bcs.bool(),
  max_entrants: bcs.u32(),
  max_judged: bcs.u32(),
  max_replies_read: bcs.u32(),
  enclave_version: bcs.u64(),
  snapshot: bcs.option(SnapshotRef),
  winners: bcs.vector(bcs.u32()),
  paid: bcs.vector(bcs.bool()),
});

/** `enclave::enclave::Enclave<T>` */
export const EnclaveBcs = bcs.struct("Enclave", {
  id: Address,
  pk: Bytes,
  config_version: bcs.u64(),
  owner: Address,
});

export interface Campaign {
  id: string;
  /** Coin type argument `C` of `Campaign<C>`. */
  coinType: string;
  organizer: string;
  mode: number;
  status: number;
  k: number;
  createdAt: number;
  closesAt: number;
  /** Walrus blob ID of the rules document (stored on-chain as its UTF-8 bytes). */
  rulesBlob: string;
  rulesHash: string;
  postId: string;
  openedAt: number;
  prizeKind: number;
  /** Object prize type `P`, fully qualified with 0x. */
  prizeType: string | null;
  pool: bigint;
  deposited: number;
  perWinner: bigint;
  remainder: bigint;
  unusedPending: boolean;
  maxEntrants: number;
  maxJudged: number;
  maxRepliesRead: number;
  enclaveVersion: number;
  snapshot: null | {
    enclaveId: string;
    fetchedAt: number;
    n: number;
    repliesSeen: number;
    root: string;
    snapshotHash: string;
    blobId: string;
    linked: boolean;
  };
  winners: number[];
  paid: boolean[];
}

const dec = new TextDecoder();

/** `0x…::campaign::Campaign<0x2::sui::SUI>` → `0x2::sui::SUI`. */
export function coinTypeOf(objectType: string): string {
  const m = /::campaign::Campaign<(.+)>$/.exec(objectType);
  if (!m) throw new Error(`not a Campaign: ${objectType}`);
  return m[1]!;
}

/** TypeName strings carry the address without 0x. */
export function qualifyType(name: string): string {
  return name.startsWith("0x") ? name : `0x${name}`;
}

export function parseCampaign(objectType: string, content: Uint8Array): Campaign {
  const c = CampaignBcs.parse(content);
  return {
    id: c.id,
    coinType: coinTypeOf(objectType),
    organizer: c.organizer,
    mode: c.mode,
    status: c.status,
    k: c.k,
    createdAt: Number(c.created_at),
    closesAt: Number(c.closes_at),
    rulesBlob: dec.decode(Uint8Array.from(c.rules_blob)),
    rulesHash: toHex(Uint8Array.from(c.rules_hash)),
    postId: c.post_id,
    openedAt: Number(c.opened_at),
    prizeKind: c.prize_kind,
    prizeType: c.prize_type ? qualifyType(c.prize_type.name) : null,
    pool: BigInt(c.pool.value),
    deposited: c.deposited,
    perWinner: BigInt(c.per_winner),
    remainder: BigInt(c.remainder),
    unusedPending: c.unused_pending,
    maxEntrants: c.max_entrants,
    maxJudged: c.max_judged,
    maxRepliesRead: c.max_replies_read,
    enclaveVersion: Number(c.enclave_version),
    snapshot: c.snapshot
      ? {
          enclaveId: c.snapshot.enclave_id,
          fetchedAt: Number(c.snapshot.fetched_at),
          n: c.snapshot.n,
          repliesSeen: c.snapshot.replies_seen,
          root: toHex(Uint8Array.from(c.snapshot.root)),
          snapshotHash: toHex(Uint8Array.from(c.snapshot.snapshot_hash)),
          blobId: dec.decode(Uint8Array.from(c.snapshot.blob_id)),
          linked: c.snapshot.linked,
        }
      : null,
    winners: c.winners,
    paid: c.paid,
  };
}
