import { describe, expect, it } from "vitest";
import { parseCanonicalRules } from "@chek/core";
import { buildRules, DEFAULT_FORM, PINNED_MODEL } from "../src/lib/rules-form.ts";
import { giveawayLink, parsePostUrl, postTimeMs } from "../src/lib/post.ts";
import { cancelTx, createCoinGiveawayTx, createObjectGiveawayTx, openTx } from "../src/lib/organizer.ts";

const ids = { packageId: "0x" + "11".repeat(32), configId: "0x" + "22".repeat(32), enclaveConfigId: "0x" + "33".repeat(32) };
const sender = "0x" + "44".repeat(32);
const params = { mode: 0 as const, k: 3, closesAt: 1_800_000_000_000, rulesBlob: "blobABC", rulesHash: "ab".repeat(32), feeMist: 0n, sender };

describe("post links", () => {
  it("parses post URLs", () => {
    expect(parsePostUrl("https://x.com/chek/status/1994000000000000000?s=20")).toBe("1994000000000000000");
    expect(parsePostUrl("https://mobile.twitter.com/a_b/status/123/photo/1")).toBe("123");
    expect(parsePostUrl("https://x.com/chek")).toBeNull();
    expect(parsePostUrl("https://evil.com/x.com/a/status/1")).toBeNull();
  });
  it("reads the time from a snowflake", () => {
    expect(postTimeMs("1994000000000000000")).toBe(Number((1994000000000000000n >> 22n) + 1288834974657n));
  });
  it("lowercases the link", () => {
    expect(giveawayLink("https://chek.app/", "0xABC")).toBe("https://chek.app/g/0xabc");
  });
});

describe("rules form", () => {
  it("builds canonical rules that round-trip", () => {
    const b = buildRules({ ...DEFAULT_FORM, requiredText: " #sui , gm ", excludeAuthorIds: "1 2, 2" });
    if (!b.ok) throw new Error(b.errors.join());
    const back = parseCanonicalRules(b.text);
    expect(back.ok && back.rules).toEqual(b.rules);
    expect(b.rules.required_text).toEqual(["#sui", "gm"]);
    expect(b.rules.exclude_author_ids).toEqual(["1", "2"]);
  });
  it("pins the model for Judged Draws and rejects an empty rubric", () => {
    const bad = buildRules({ ...DEFAULT_FORM, mode: "judged" });
    expect(bad.ok).toBe(false);
    const ok = buildRules({ ...DEFAULT_FORM, mode: "judged", rubric: "Reply includes a drawing of a cat." });
    expect(ok.ok && ok.rules.rubric?.model).toBe(PINNED_MODEL);
  });
});

describe("organizer transactions", () => {
  const calls = (tx: { getData(): { commands: unknown[] } }) =>
    tx.getData().commands.map((c) => {
      const m = (c as { MoveCall?: { function: string } }).MoveCall;
      return m ? m.function : Object.keys(c as object).find((k) => k !== "$kind");
    });

  it("creates, funds and shares a coin giveaway in one transaction", () => {
    const tx = createCoinGiveawayTx(ids, params, "0x2::sui::SUI", 300n);
    expect(calls(tx).filter((n) => n !== "$Intent")).toEqual(["create", "fund_coin", "share", "TransferObjects"]);
  });
  it("deposits each object in rank order", () => {
    const tx = createObjectGiveawayTx(ids, params, "0x5::nft::Nft", ["0x" + "a1".repeat(32), "0x" + "a2".repeat(32), "0x" + "a3".repeat(32)]);
    expect(calls(tx).filter((n) => n !== "$Intent")).toEqual(["create", "deposit_object", "deposit_object", "deposit_object", "share", "TransferObjects"]);
    expect(() => createObjectGiveawayTx(ids, params, "0x5::nft::Nft", ["0x1"])).toThrow(/exactly 3/);
  });
  it("opens and cancels with the cap", () => {
    expect(calls(openTx(ids, "0x" + "c1".repeat(32), "0x2::sui::SUI", "0x" + "ca".repeat(32), "1994000000000000000"))).toEqual(["open"]);
    expect(calls(cancelTx(ids, "0x" + "c1".repeat(32), "0x2::sui::SUI", "0x" + "ca".repeat(32)))).toEqual(["cancel"]);
  });
});
