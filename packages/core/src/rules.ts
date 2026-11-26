import { blake2b256 } from "./hash.ts";
import { canonicalize, CanonicalError } from "./canonical.ts";

/**
 * Rules document, version 1 (spec section 8). Stored on Walrus as canonical JSON; its
 * Blake2b-256 hash is committed at creation and checked again by the enclave before a snapshot.
 *
 * X user IDs are 64-bit and exceed JavaScript's safe integer range, so they are decimal strings.
 */
export interface RulesV1 {
  v: 1;
  platform: "x";
  mode: "draw" | "judged";
  entry: "reply";
  direct_replies_only: boolean;
  min_account_age_days: number;
  min_followers: number;
  required_text: string[];
  require_media: boolean;
  exclude_author_ids: string[];
  exclude_post_author: true;
  rubric: Rubric | null;
}

export interface Rubric {
  prompt: string;
  model: string;
}

export const RULES_LIMITS = {
  MAX_ACCOUNT_AGE_DAYS: 3650,
  MAX_MIN_FOLLOWERS: 1_000_000,
  MAX_REQUIRED_TEXT: 5,
  MAX_REQUIRED_TEXT_CHARS: 100,
  MAX_EXCLUDED_AUTHORS: 50,
  MAX_PROMPT_CHARS: 2000,
  MAX_MODEL_CHARS: 100,
} as const;

const RULE_KEYS = [
  "v",
  "platform",
  "mode",
  "entry",
  "direct_replies_only",
  "min_account_age_days",
  "min_followers",
  "required_text",
  "require_media",
  "exclude_author_ids",
  "exclude_post_author",
  "rubric",
] as const;

const U64_MAX = 18446744073709551615n;
const DECIMAL_U64 = /^(0|[1-9][0-9]{0,19})$/;

export type RulesResult = { ok: true; rules: RulesV1 } | { ok: false; errors: string[] };

/** Unicode code points, the unit every character limit in the spec counts. */
function chars(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function intInRange(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

/** Validates a parsed rules value. The same checks, in the same order, exist in enclave/chek-enclave/src/chek-core. */
export function validateRules(value: unknown): RulesResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) return { ok: false, errors: ["rules: must be an object"] };

  for (const k of Object.keys(value)) {
    if (!(RULE_KEYS as readonly string[]).includes(k)) errors.push(`${k}: unknown field`);
  }
  for (const k of RULE_KEYS) {
    if (!(k in value)) errors.push(`${k}: missing`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const r = value;
  if (r.v !== 1) errors.push("v: must be 1");
  if (r.platform !== "x") errors.push('platform: must be "x"');
  if (r.mode !== "draw" && r.mode !== "judged") errors.push('mode: must be "draw" or "judged"');
  if (r.entry !== "reply") errors.push('entry: must be "reply"');
  if (typeof r.direct_replies_only !== "boolean") errors.push("direct_replies_only: must be a boolean");
  if (!intInRange(r.min_account_age_days, 0, RULES_LIMITS.MAX_ACCOUNT_AGE_DAYS)) {
    errors.push(`min_account_age_days: integer 0..${RULES_LIMITS.MAX_ACCOUNT_AGE_DAYS}`);
  }
  if (!intInRange(r.min_followers, 0, RULES_LIMITS.MAX_MIN_FOLLOWERS)) {
    errors.push(`min_followers: integer 0..${RULES_LIMITS.MAX_MIN_FOLLOWERS}`);
  }

  if (!Array.isArray(r.required_text)) {
    errors.push("required_text: must be an array");
  } else {
    if (r.required_text.length > RULES_LIMITS.MAX_REQUIRED_TEXT) {
      errors.push(`required_text: at most ${RULES_LIMITS.MAX_REQUIRED_TEXT} strings`);
    }
    r.required_text.forEach((t, i) => {
      if (typeof t !== "string" || t.trim().length === 0 || chars(t) > RULES_LIMITS.MAX_REQUIRED_TEXT_CHARS) {
        errors.push(`required_text[${i}]: non-blank string of at most ${RULES_LIMITS.MAX_REQUIRED_TEXT_CHARS} characters`);
      }
    });
  }

  if (typeof r.require_media !== "boolean") errors.push("require_media: must be a boolean");

  if (!Array.isArray(r.exclude_author_ids)) {
    errors.push("exclude_author_ids: must be an array");
  } else {
    if (r.exclude_author_ids.length > RULES_LIMITS.MAX_EXCLUDED_AUTHORS) {
      errors.push(`exclude_author_ids: at most ${RULES_LIMITS.MAX_EXCLUDED_AUTHORS} ids`);
    }
    const seen = new Set<string>();
    r.exclude_author_ids.forEach((id, i) => {
      if (typeof id !== "string" || !DECIMAL_U64.test(id) || BigInt(id) > U64_MAX) {
        errors.push(`exclude_author_ids[${i}]: decimal u64 string without leading zeros`);
      } else if (seen.has(id)) {
        errors.push(`exclude_author_ids[${i}]: duplicate`);
      } else {
        seen.add(id);
      }
    });
  }

  if (r.exclude_post_author !== true) errors.push("exclude_post_author: must be true");

  if (r.rubric === null) {
    if (r.mode === "judged") errors.push("rubric: required when mode is judged");
  } else if (!isPlainObject(r.rubric)) {
    errors.push("rubric: must be null or an object");
  } else {
    const rb = r.rubric;
    const keys = Object.keys(rb).sort().join(",");
    if (keys !== "model,prompt") errors.push("rubric: must have exactly prompt and model");
    if (typeof rb.prompt !== "string" || rb.prompt.trim().length === 0 || chars(rb.prompt) > RULES_LIMITS.MAX_PROMPT_CHARS) {
      errors.push(`rubric.prompt: non-blank string of at most ${RULES_LIMITS.MAX_PROMPT_CHARS} characters`);
    }
    if (typeof rb.model !== "string" || rb.model.trim().length === 0 || chars(rb.model) > RULES_LIMITS.MAX_MODEL_CHARS) {
      errors.push(`rubric.model: non-blank string of at most ${RULES_LIMITS.MAX_MODEL_CHARS} characters`);
    }
    if (r.mode === "draw") errors.push("rubric: must be null when mode is draw");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules: r as unknown as RulesV1 };
}

/** The exact bytes uploaded to Walrus for a rules document. */
export function canonicalRules(rules: RulesV1): string {
  const result = validateRules(rules);
  if (!result.ok) throw new Error(`invalid rules: ${result.errors.join("; ")}`);
  return canonicalize(rules);
}

const encoder = new TextEncoder();

/** rules_hash committed on-chain: Blake2b-256 of the canonical rules bytes. */
export function rulesHash(rules: RulesV1): Uint8Array {
  return blake2b256(encoder.encode(canonicalRules(rules)));
}

export type ParsedRules = { ok: true; rules: RulesV1; hash: Uint8Array } | { ok: false; errors: string[] };

/**
 * What the enclave does with the rules text it is sent: parse, validate, and require that the text
 * is already canonical, so one document has exactly one accepted byte string and one hash.
 */
export function parseCanonicalRules(text: string): ParsedRules {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["rules: not valid JSON"] };
  }
  const result = validateRules(value);
  if (!result.ok) return result;
  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch (e) {
    if (e instanceof CanonicalError) return { ok: false, errors: [`rules: ${e.message}`] };
    throw e;
  }
  if (canonical !== text) return { ok: false, errors: ["rules: text is not in canonical form"] };
  return { ok: true, rules: result.rules, hash: blake2b256(encoder.encode(text)) };
}
