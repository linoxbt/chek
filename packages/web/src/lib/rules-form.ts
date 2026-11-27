import { canonicalRules, rulesHash, toHex, validateRules, type RulesV1 } from "@chek/core";

/** What the Create form collects. Defaults are the values most giveaways use. */
export interface RulesForm {
  mode: "draw" | "judged";
  directRepliesOnly: boolean;
  minAccountAgeDays: number;
  minFollowers: number;
  requiredText: string;
  requireMedia: boolean;
  excludeAuthorIds: string;
  rubric: string;
}

export const DEFAULT_FORM: RulesForm = {
  mode: "draw",
  directRepliesOnly: true,
  minAccountAgeDays: 30,
  minFollowers: 10,
  requiredText: "",
  requireMedia: false,
  excludeAuthorIds: "",
  rubric: "",
};

/** The model the enclave build pins (enclave/…/apps/chek/mod.rs LLM_MODEL_ID). */
export const PINNED_MODEL = "claude-opus-5-5";

const list = (s: string, sep: RegExp) =>
  s.split(sep).map((x) => x.trim()).filter(Boolean);

export function toRules(f: RulesForm): RulesV1 {
  return {
    v: 1,
    platform: "x",
    mode: f.mode,
    entry: "reply",
    direct_replies_only: f.directRepliesOnly,
    min_account_age_days: Math.trunc(f.minAccountAgeDays),
    min_followers: Math.trunc(f.minFollowers),
    required_text: list(f.requiredText, /,/),
    require_media: f.requireMedia,
    exclude_author_ids: [...new Set(list(f.excludeAuthorIds, /[\s,]+/))],
    exclude_post_author: true,
    rubric: f.mode === "judged" ? { prompt: f.rubric.trim(), model: PINNED_MODEL } : null,
  };
}

export type Built = { ok: true; text: string; hash: string; rules: RulesV1 } | { ok: false; errors: string[] };

/** The exact bytes to upload to Walrus and the hash to commit at creation (MD5). */
export function buildRules(f: RulesForm): Built {
  const rules = toRules(f);
  const v = validateRules(rules);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, text: canonicalRules(rules), hash: toHex(rulesHash(rules)), rules };
}

/** X API read cost for one snapshot (spec section 10): $0.005 per post, $0.010 per user. */
export function estimateXCostUsd(replies: number): { low: number; high: number } {
  return { low: replies * 0.005, high: replies * 0.015 };
}
