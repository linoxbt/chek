import { describe, expect, it } from "vitest";
import { Status } from "@chek/core";
import { DemoReader, DEMO_SNAPSHOT_BLOB } from "../src/lib/demo.ts";
import { lookupEntrant, verifyCampaign } from "../src/lib/verify-page.ts";
import fixture from "../../../fixtures/snapshot-e2e.json";

const SETTLED = fixture.request.campaign_id;
const enc = new TextEncoder();

/** A DemoReader with one thing changed. */
function tampered(patch: (r: DemoReader) => void) {
  const r = new DemoReader();
  patch(r);
  return r;
}

describe("verifyCampaign", () => {
  it("passes every check on the demo Judged Draw", async () => {
    const rep = await verifyCampaign(new DemoReader(), SETTLED);
    expect(rep.checks.filter((c) => c.state !== "pass")).toEqual([]);
    expect(rep.checks.map((c) => c.id)).toEqual(["rules", "mode", "enclave", "signature", "doc-hash", "doc-canonical", "doc-fields", "root", "linked", "rubric", "draw", "payouts"]);
    expect(rep.ok).toBe(true);
    expect(rep.winners.map((w) => w.entrant?.handle)).toEqual(["user23", "user21"]);
    expect(rep.winners.every((w) => w.proofOk)).toBe(true);
  });

  it("an open giveaway has no snapshot yet and nothing failing", async () => {
    const r = new DemoReader();
    const open = (await r.campaigns()).find((c) => c.status === Status.OPEN)!;
    const rep = await verifyCampaign(r, open.id);
    expect(rep.ok).toBe(true);
    expect(rep.checks.at(-1)).toMatchObject({ id: "snapshot", state: "pending" });
  });

  it("fails when the snapshot file on Walrus was changed", async () => {
    const r = tampered((x) => {
      const orig = x.blob.bind(x);
      x.blob = async (id) => (id === DEMO_SNAPSHOT_BLOB ? enc.encode(new TextDecoder().decode(await orig(id)).replace("user21", "userXX")) : orig(id));
    });
    const rep = await verifyCampaign(r, SETTLED);
    expect(rep.ok).toBe(false);
    expect(rep.checks.find((c) => c.id === "doc-hash")!.state).toBe("fail");
  });

  it("fails when the rules on Walrus differ from the hash", async () => {
    const r = tampered((x) => {
      const orig = x.blob.bind(x);
      x.blob = async (id) => (id === DEMO_SNAPSHOT_BLOB ? orig(id) : enc.encode(new TextDecoder().decode(await orig(id)).replace('"min_followers":', '"min_followers":1')));
    });
    const rep = await verifyCampaign(r, SETTLED);
    expect(rep.checks.find((c) => c.id === "rules")!.state).toBe("fail");
  });

  it("fails when the enclave is on another version than the pin", async () => {
    const r = tampered((x) => {
      x.enclave = async () => ({ publicKey: fixture.response.public_key, configVersion: 1 });
    });
    expect((await verifyCampaign(r, SETTLED)).checks.find((c) => c.id === "enclave")!.state).toBe("fail");
  });

  it("fails when a payout went somewhere else", async () => {
    const r = tampered((x) => {
      const orig = x.history.bind(x);
      x.history = async () => {
        const h = await orig();
        h.payouts[0]!.to = "0x" + "ff".repeat(32);
        return h;
      };
    });
    expect((await verifyCampaign(r, SETTLED)).checks.find((c) => c.id === "payouts")!.state).toBe("fail");
  });
});

describe("lookupEntrant", () => {
  const doc = JSON.parse(fixture.response.snapshot_json);
  it("finds by handle, address and reply link", () => {
    expect(lookupEntrant(doc, [1, 0], "@User23")).toMatchObject({ kind: "entrant", winnerRank: 1 });
    expect(lookupEntrant(doc, [1], "0x" + "aa".repeat(32))).toMatchObject({ kind: "entrant", winnerRank: null });
    expect(lookupEntrant(doc, [], "https://x.com/user21/status/1994000000000000001")).toMatchObject({ kind: "entrant" });
  });
  it("explains an excluded reply", () => {
    expect(lookupEntrant(doc, [], "https://x.com/a/status/1994000000000000002")).toEqual({ kind: "excluded", replyId: "1994000000000000002", code: "AI_FAIL", text: "no drawing" });
    expect(lookupEntrant(doc, [], "1994000000000000004")).toMatchObject({ code: "SUINS_UNRESOLVED", text: "The SuiNS name did not resolve to an address." });
    expect(lookupEntrant(doc, [], "nobody")).toEqual({ kind: "none" });
  });
});
