import { bcs } from "@mysten/bcs";
import { describe, expect, it } from "vitest";
import { blake2b256, fromHex, toHex, verifyProof, type SnapshotDocument } from "@chek/core";
import { CampaignBcs, coinTypeOf, parseCampaign, PRIZE_OBJECTS, qualifyType, Status } from "../src/campaign.ts";
import { plan } from "../src/plan.ts";
import { commitTx, distributeTx, drawTx, refundObjectsTx } from "../src/txs.ts";
import { calls, campaign, ENCLAVE, fixture, PKG } from "./world.ts";

const ids = { packageId: PKG, enclaveId: ENCLAVE };
const CLOSE = fixture.request.closes_at;

describe("campaign decoding", () => {
  it("round-trips the Move layout and reads the type arguments", () => {
    const bytes = CampaignBcs.serialize({
      id: fixture.request.campaign_id, organizer: "0x" + "0a".repeat(32), mode: 1, status: 3, k: 3, created_at: 1, closes_at: CLOSE,
      rules_blob: Array.from(new TextEncoder().encode("blob-1")), rules_hash: Array.from(fromHex("aa".repeat(32))),
      post_id: fixture.request.post_id, opened_at: fixture.request.opened_at, prize_kind: 1,
      prize_type: { name: "c0de000000000000000000000000000000000000000000000000000000000000::yeti::Yeti" },
      pool: { value: 0 }, deposited: 3, per_winner: 0, remainder: 0, unused_pending: true, max_entrants: 5000, max_judged: 1000,
      max_replies_read: 20000, enclave_version: 2,
      snapshot: { enclave_id: ENCLAVE, fetched_at: 9, n: 2, replies_seen: 5, root: Array(32).fill(1), snapshot_hash: Array(32).fill(2),
        blob_id: Array.from(new TextEncoder().encode("snap")), linked: true, post_author_id: 10, request_counter: 3 },
      winners: [1, 0], paid: [true, false],
    }).toBytes();
    const c = parseCampaign(`${PKG}::campaign::Campaign<0x2::sui::SUI>`, bytes);
    expect(c.coinType).toBe("0x2::sui::SUI");
    expect(c.prizeType).toBe("0xc0de000000000000000000000000000000000000000000000000000000000000::yeti::Yeti");
    expect([c.rulesBlob, c.snapshot?.blobId, c.enclaveVersion]).toEqual(["blob-1", "snap", 2]);
    expect([c.winners, c.paid, c.unusedPending]).toEqual([[1, 0], [true, false], true]);
    expect(coinTypeOf(`${PKG}::campaign::Campaign<${PKG}::lofi::LOFI>`)).toBe(`${PKG}::lofi::LOFI`);
    expect(qualifyType("0x2::sui::SUI")).toBe("0x2::sui::SUI");
  });
});

describe("plan", () => {
  const H = 3600_000;
  it.each([
    [Status.DRAFT, CLOSE + H, false, "wait"],
    [Status.OPEN, CLOSE - 1, false, "wait"],
    [Status.OPEN, CLOSE + 30_000, false, "snapshot"],
    [Status.OPEN, CLOSE + 6 * H, false, "snapshot"],
    [Status.OPEN, CLOSE + 6 * H + 1, false, "wait"],
    [Status.OPEN, CLOSE + 10 * H, true, "commit"],
    [Status.OPEN, CLOSE + 48 * H + 1, true, "expire"],
    [Status.COMMITTED, CLOSE + H, false, "draw"],
    [Status.SETTLED, CLOSE + H, false, "done"],
    [Status.CANCELLED, CLOSE + H, false, "done"],
  ] as const)("status %i at close%+d, held=%s → %s", (status, now, held, kind) => {
    expect(plan(campaign({ status }), now, held, false).kind).toBe(kind);
  });

  it("pays unpaid ranks, then reclaims, then refunds objects after cancel or expiry", () => {
    expect(plan(campaign({ status: Status.DRAWN, paid: [true, false, false] }), 0, false, false)).toEqual({ kind: "distribute", ranks: [1, 2] });
    expect(plan(campaign({ status: Status.DRAWN, paid: [true], unusedPending: true }), 0, false, false).kind).toBe("reclaim");
    const obj = { prizeKind: PRIZE_OBJECTS, prizeType: "0x1::a::B" };
    expect(plan(campaign({ ...obj, status: Status.EXPIRED }), 0, false, true).kind).toBe("refund_objects");
    expect(plan(campaign({ ...obj, status: Status.EXPIRED }), 0, false, false).kind).toBe("done");
    const settledNoEntrants = campaign({ ...obj, status: Status.SETTLED, snapshot: { enclaveId: ENCLAVE, fetchedAt: 0, n: 0, repliesSeen: 0, root: "", snapshotHash: "", blobId: "", linked: false } });
    expect(plan(settledNoEntrants, 0, false, true).kind).toBe("refund_objects");
  });
});

describe("transactions", () => {
  it("commit builds the payload with snapshot::new and passes it to commit_snapshot", () => {
    const r = fixture.response;
    const tx = commitTx(ids, campaign(), r.payload, r.signature, "snap-blob-1");
    expect(calls(tx)).toEqual([
      { target: `${PKG}::snapshot::new`, typeArguments: [] },
      { target: `${PKG}::campaign::commit_snapshot`, typeArguments: ["0x2::sui::SUI"] },
    ]);
    const inputs = tx.getData().inputs;
    expect(inputs.filter((i) => i.$kind === "UnresolvedObject").map((i) => i.UnresolvedObject!.objectId)).toEqual([
      fixture.request.campaign_id, ENCLAVE, "0x0000000000000000000000000000000000000000000000000000000000000006",
    ]);
  });

  it("draw uses the Random object", () => {
    const tx = drawTx(ids, campaign());
    expect(calls(tx)[0]!.target).toBe(`${PKG}::campaign::draw`);
    expect(tx.getData().inputs.some((i) => i.UnresolvedObject?.objectId.endsWith("8"))).toBe(true);
  });

  it("distribute proves each winner against the committed root", () => {
    const doc = JSON.parse(fixture.response.snapshot_json) as SnapshotDocument;
    const c = campaign({ status: Status.DRAWN, winners: [1, 0], paid: [false, false] });
    const tx = distributeTx(ids, c, doc, [0, 1]);
    expect(calls(tx).map((x) => x.target.split("::").pop())).toEqual(["distribute_coin", "distribute_coin"]);
    // Read each call's arguments back out of the transaction and check the proof it carries.
    const data = tx.getData();
    const pure = (arg: { $kind: string; Input?: number }) => Buffer.from(data.inputs[arg.Input!]!.Pure!.bytes, "base64");
    const root = fromHex(fixture.response.payload.root);
    data.commands.forEach((cmd, rank) => {
      const args = cmd.MoveCall!.arguments as { $kind: string; Input?: number }[];
      const i = bcs.u32().parse(pure(args[2]!));
      const author = bcs.u64().parse(pure(args[3]!));
      const to = toHex(pure(args[4]!));
      const proof = bcs.vector(bcs.vector(bcs.u8())).parse(pure(args[5]!)).map((p) => Uint8Array.from(p));
      expect(i).toBe(c.winners[rank]);
      expect(verifyProof(root, { i, author_id: author, address: `0x${to}` }, proof)).toBe(true);
    });
    expect(toHex(blake2b256(new TextEncoder().encode(fixture.response.snapshot_json)))).toBe(fixture.response.payload.snapshot_hash);
  });

  it("object prizes carry the prize type", () => {
    const c = campaign({ prizeKind: PRIZE_OBJECTS, prizeType: "0x1::a::B", status: Status.EXPIRED });
    expect(calls(refundObjectsTx(ids, c))[0]!.typeArguments).toEqual(["0x2::sui::SUI", "0x1::a::B"]);
    expect(() => refundObjectsTx(ids, campaign())).toThrow();
  });
});
