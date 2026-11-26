# Rules and encoding reference

How Chek turns a giveaway's rules and entrant list into bytes. The same rules are implemented
three times — `packages/core` (TypeScript), `enclave/chek-enclave/src/chek-core` (Rust) and `move/chek` (Move) — and
all three are tested against [`fixtures/vectors.json`](../fixtures/vectors.json).

## Rules document (version 1)

Uploaded to Walrus as canonical JSON. `rules_hash` = Blake2b-256 of those exact bytes.

| Field | Type | Allowed values |
| --- | --- | --- |
| `v` | integer | `1` |
| `platform` | string | `"x"` |
| `mode` | string | `"draw"` or `"judged"` |
| `entry` | string | `"reply"` |
| `direct_replies_only` | boolean | |
| `min_account_age_days` | integer | 0–3650 |
| `min_followers` | integer | 0–1,000,000 |
| `required_text` | string[] | at most 5; each non-blank, at most 100 characters; matched case-insensitively |
| `require_media` | boolean | |
| `exclude_author_ids` | string[] | at most 50 distinct X user IDs, as decimal u64 strings without leading zeros |
| `exclude_post_author` | boolean | `true` |
| `rubric` | object or null | `null` for draw; `{ "prompt", "model" }` for judged, prompt non-blank and at most 2,000 characters, model non-blank and at most 100 |

Every field is required and no other field is allowed.

## Decisions made while building Phase 0

- **X user IDs are strings.** They are 64-bit and exceed JavaScript's safe integer range, so a
  number would be rounded differently by different JSON parsers.
- **Only integers.** Canonical JSON here accepts null, booleans, integers within ±(2^53 − 1),
  strings, arrays and objects. Fractions and exponents are refused, which removes the one part of
  RFC 8785 (number formatting) that is hard to match across languages.
- **Rules must arrive canonical.** The enclave accepts rules text only if re-canonicalising it gives
  the same bytes, so a document has exactly one accepted encoding and one hash.
- **Characters are Unicode code points.** Length limits count code points, not UTF-16 units or bytes.
- **"Blank" means JavaScript `trim()` whitespace.** U+FEFF counts as blank and U+0085 does not, in
  both TypeScript and Rust.

## Entrant leaves and the Merkle tree

```
leaf = Blake2b-256(0x00 ‖ BCS(Leaf { i: u32, author_id: u64, address: address }))
node = Blake2b-256(0x01 ‖ left ‖ right)
```

- BCS of a leaf is 44 bytes: `i` little-endian (4), `author_id` little-endian (8), address (32).
- Leaves are in index order and padded to the next power of two with Blake2b-256(0x00).
- A proof lists sibling hashes from the leaf upwards. Bit k of `i` says whether the running hash is
  the left (0) or right (1) child at level k, and verification fails unless the proof consumes
  every bit of `i`, so one proof can't be reused for a higher index.
- One entrant: the root is that leaf's hash and the proof is empty. No entrants: the root is the
  padding leaf.
- 5,000 entrants need depth 13.

## Regenerating vectors

`pnpm vectors` rewrites `fixtures/vectors.json` and `move/chek/tests/merkle_vectors_tests.move`.
CI runs `pnpm vectors:check` and fails if either is stale.

## Entrant filter (Phase 3)

`enclave/chek-enclave/src/chek-core/src/filter.rs` applies the section 10 rules. It does no I/O: the enclave
resolves the SuiNS names `names_to_resolve` lists, calls `select`, sends `to_judge` to the LLM
(Judged Draw), then calls `finalize`. Same inputs, same snapshot.

| Order | Rule | Code |
| --- | --- | --- |
| 0 | Beyond `max_replies_read`, counting by reply ID | `OVER_CAP` |
| 1 | Created before `opened_at` or after `closes_at` | `LATE` |
| 2 | `direct_replies_only` and the parent is not the post | `NOT_DIRECT` |
| 3 | The post's author, or in `exclude_author_ids` | `EXCLUDED` |
| 4 | Account younger than the minimum at close / too few followers at fetch | `TOO_YOUNG` / `FEW_FOLLOWERS` |
| 5 | A required text missing (Unicode case-insensitive) / no media when required | `MISSING_TEXT` / `NO_MEDIA` |
| 6 | No address; a SuiNS name that does not resolve | `NO_ADDRESS` / `SUINS_UNRESOLVED` |
| 7 | Same author as an earlier reply that passed 0–6 | `DUP_ACCOUNT` |
| 8 | Same address as an earlier eligible reply | `DUP_ADDRESS` |
| 9 | Judged Draw: failed the rubric / beyond `max_judged` | `AI_FAIL` / `OVER_CAP` |
| 10 | Beyond `max_entrants` | `OVER_CAP` |

Decisions made while building it:

- **Addresses.** A hex address is `0x` (or `0X`) plus exactly 64 hex digits, with no ASCII letter
  or digit directly before the `0` or after the last digit; it is lowercased. The first one in the
  reply wins, wherever a SuiNS name appears.
- **SuiNS names.** A token of ASCII letters, digits, dots and hyphens, trailing dots dropped,
  ending in `.sui`, labels of 1–63 characters not starting or ending with `-`, main label at
  least 3 characters. `@yeti.sui` gives `yeti.sui`. A name that is not looked up counts as
  unresolved.
- **The post itself** and repeated reply IDs (pages returned twice) are dropped before counting.
- **The judge's reason** is cut to 200 Unicode characters. If any reply that must be judged has no
  verdict, the whole snapshot fails, so an LLM outage never fails entries.
- **Text.** The X client must undo the API's `&amp;`, `&lt;`, `&gt;` escaping before the filter.
  The filter's output carries IDs, handles, addresses, SuiNS names and codes only (MD10).
- **Links.** `is_linked` accepts `http(s)://(www.)chek.app/g/0x<campaign id>` with an optional
  trailing slash, query or fragment, from X's expanded URLs.

Tests: `fixtures/filter-cases.json` has hand-written expected outcomes covering all 13 codes and
the boundaries; `fixtures/filter-random.json` holds seeded random giveaways whose outcomes come
from Rust. Both are also run by a test-only TypeScript port (`packages/core/test/port/filter.ts`).
