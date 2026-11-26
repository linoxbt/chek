/**
 * Test-only TypeScript port of the enclave's rules filter (enclave/chek-core/src/filter.rs).
 * The filter itself exists once, in Rust (spec section 18); this port exists to cross-check it on
 * recorded fixtures. Keep the two in step.
 */
import type { RulesV1 } from "../../src/index.ts";

export const DAY_MS = 86_400_000;

export interface Author { id: string; handle: string; created_at_ms: number; followers: number }
export interface Reply { reply_id: string; parent_id: string | null; created_at_ms: number; text: string; has_media: boolean; author: Author }
export interface FilterContext {
  post_id: string; post_author_id: string; opened_at_ms: number; closes_at_ms: number;
  max_entrants: number; max_judged: number; max_replies_read: number;
}
export interface Verdict { pass: boolean; reason: string }
export interface Entrant { i: number; reply_id: string; author_id: string; handle: string; address: string; via: string; verdict: "pass" }
export interface Excluded { reply_id: string; author_id: string; code: string; reason?: string }
export interface Outcome { replies_seen: number; entrants: Entrant[]; excluded: Excluded[] }

const isAsciiAlnum = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9]$/.test(c);
const isHex = (c: string | undefined) => c !== undefined && /^[0-9A-Fa-f]$/.test(c);

export function firstHexAddress(text: string): string | null {
  for (let i = 0; i + 2 <= text.length; i++) {
    if (text[i] !== "0" || (text[i + 1] !== "x" && text[i + 1] !== "X") || (i > 0 && isAsciiAlnum(text[i - 1]))) continue;
    let j = i + 2;
    while (j < text.length && isHex(text[j])) j++;
    if (j - (i + 2) === 64 && !isAsciiAlnum(text[j])) return `0x${text.slice(i + 2, j).toLowerCase()}`;
  }
  return null;
}

const validLabel = (l: string) => l.length >= 1 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l);

export function firstSuiName(text: string): string | null {
  for (const raw of text.split(/[^A-Za-z0-9.-]/)) {
    const tok = raw.replace(/\.+$/, "").toLowerCase();
    if (!tok.endsWith(".sui")) continue;
    const labels = tok.slice(0, -4).split(".");
    if (labels[labels.length - 1]!.length >= 3 && labels.every(validLabel)) return tok;
  }
  return null;
}

type Source = { hex: string } | { name: string };

function check(ctx: FilterContext, rules: RulesV1, r: Reply): Source | string {
  if (r.created_at_ms < ctx.opened_at_ms || r.created_at_ms > ctx.closes_at_ms) return "LATE";
  if (rules.direct_replies_only && r.parent_id !== ctx.post_id) return "NOT_DIRECT";
  if (r.author.id === ctx.post_author_id || rules.exclude_author_ids.includes(r.author.id)) return "EXCLUDED";
  if (Math.max(0, ctx.closes_at_ms - r.author.created_at_ms) < rules.min_account_age_days * DAY_MS) return "TOO_YOUNG";
  if (r.author.followers < rules.min_followers) return "FEW_FOLLOWERS";
  const lower = r.text.toLowerCase();
  if (!rules.required_text.every((t) => lower.includes(t.toLowerCase()))) return "MISSING_TEXT";
  if (rules.require_media && !r.has_media) return "NO_MEDIA";
  const hex = firstHexAddress(r.text);
  if (hex) return { hex };
  const name = firstSuiName(r.text);
  return name ? { name } : "NO_ADDRESS";
}

const byId = (a: { reply_id: string }, b: { reply_id: string }) => {
  const x = BigInt(a.reply_id), y = BigInt(b.reply_id);
  return x < y ? -1 : x > y ? 1 : 0;
};

export class MissingVerdict extends Error {
  constructor(readonly replyId: string) { super(`MissingVerdict:${replyId}`); }
}

export function runFilter(
  ctx: FilterContext, rules: RulesV1, replies: Reply[],
  names: Record<string, string | null>, verdicts: Record<string, Verdict>,
): Outcome {
  const seenIds = new Set<string>();
  const all = replies.filter((r) => r.reply_id !== ctx.post_id && !seenIds.has(r.reply_id) && seenIds.add(r.reply_id)).sort(byId);
  const read = all.slice(0, ctx.max_replies_read);
  const excluded: Excluded[] = all.slice(ctx.max_replies_read).map((r) => ({ reply_id: r.reply_id, author_id: r.author.id, code: "OVER_CAP" }));
  const ex = (r: Reply, code: string) => excluded.push({ reply_id: r.reply_id, author_id: r.author.id, code });

  const authors = new Set<string>(), addresses = new Set<string>();
  const eligible: { r: Reply; address: string; name: string | null }[] = [];
  for (const r of read) {
    const c = check(ctx, rules, r);
    if (typeof c === "string") { ex(r, c); continue; }
    let address: string, name: string | null = null;
    if ("hex" in c) address = c.hex;
    else {
      const a = names[c.name];
      if (!a) { ex(r, "SUINS_UNRESOLVED"); continue; }
      address = a; name = c.name;
    }
    if (authors.has(r.author.id)) { ex(r, "DUP_ACCOUNT"); continue; }
    authors.add(r.author.id);
    if (addresses.has(address)) { ex(r, "DUP_ADDRESS"); continue; }
    addresses.add(address);
    eligible.push({ r, address, name });
  }

  const passed: typeof eligible = [];
  eligible.forEach((e, k) => {
    if (rules.mode === "judged") {
      if (k >= ctx.max_judged) return ex(e.r, "OVER_CAP");
      const v = verdicts[e.r.reply_id];
      if (!v) throw new MissingVerdict(e.r.reply_id);
      if (!v.pass) return excluded.push({ reply_id: e.r.reply_id, author_id: e.r.author.id, code: "AI_FAIL", reason: [...v.reason].slice(0, 200).join("") });
    }
    passed.push(e);
  });

  const entrants: Entrant[] = [];
  for (const e of passed) {
    if (entrants.length >= ctx.max_entrants) { ex(e.r, "OVER_CAP"); continue; }
    entrants.push({ i: entrants.length, reply_id: e.r.reply_id, author_id: e.r.author.id, handle: e.r.author.handle,
      address: e.address, via: e.name ? `suins:${e.name}` : "hex", verdict: "pass" });
  }
  excluded.sort(byId);
  return { replies_seen: read.length, entrants, excluded };
}
