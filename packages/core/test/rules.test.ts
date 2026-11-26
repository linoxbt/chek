import { describe, expect, it } from "vitest";
import { canonicalRules, parseCanonicalRules, rulesHash, toHex, validateRules, type RulesV1 } from "../src/index.ts";

const rules: RulesV1 = {
  v: 1,
  platform: "x",
  mode: "draw",
  entry: "reply",
  direct_replies_only: true,
  min_account_age_days: 0,
  min_followers: 0,
  required_text: [],
  require_media: false,
  exclude_author_ids: [],
  exclude_post_author: true,
  rubric: null,
};

describe("rules", () => {
  it("round-trips: canonical text parses back to the same hash", () => {
    const text = canonicalRules(rules);
    const parsed = parseCanonicalRules(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(toHex(parsed.hash)).toBe(toHex(rulesHash(rules)));
  });
  it("one character changes the hash (AC5)", () => {
    const a = rulesHash(rules);
    const b = rulesHash({ ...rules, min_followers: 1 });
    expect(toHex(a)).not.toBe(toHex(b));
  });
  it("reports every problem, not just the first", () => {
    const r = validateRules({ ...rules, v: 2, platform: "telegram", min_followers: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });
  it("canonicalRules refuses invalid rules", () => {
    expect(() => canonicalRules({ ...rules, mode: "judged" })).toThrow(/rubric/);
  });
});
