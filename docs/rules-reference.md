# Rules and encoding reference

How Chek turns a giveaway's rules and entrant list into bytes. The same rules are implemented
three times — `packages/core` (TypeScript), `enclave/chek-core` (Rust) and `move/chek` (Move) — and
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
