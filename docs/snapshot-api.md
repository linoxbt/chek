# Enclave `/snapshot` API

The runner's only call into the enclave (spec section 12). Implemented in
`enclave/chek-enclave/src/nautilus-server/src/apps/chek/snapshot.rs`.

## Request

`POST /snapshot`, JSON body, header `X-Chek-Auth: <hex HMAC-SHA256 of the raw body, key ENCLAVE_HMAC_KEY>`.

| Field | Type | Source |
| --- | --- | --- |
| `campaign_id` | `0x` + 64 hex | Campaign object ID |
| `post_id` | decimal string | `Campaign.post_id` |
| `opened_at`, `closes_at` | integer ms | `Campaign.opened_at` (post's creation time), `Campaign.closes_at` |
| `mode`, `k` | integer | `Campaign.mode`, `Campaign.k` |
| `max_entrants`, `max_judged`, `max_replies_read` | integer | the campaign's copies |
| `rules_json` | string | the rules document from Walrus, byte for byte |

The enclave checks only what it can check itself (rules canonical and valid, mode matches the
rules, caps in range, `opened_at` equals the post ID's time, the fetch window). Everything else is
echoed into the signed payload, and `commit_snapshot` rejects any field that differs from the
campaign.

## Response 200

| Field | Meaning |
| --- | --- |
| `payload` | Payload fields (IDs as strings, bytes as hex): build `snapshot::new(…)` from these |
| `payload_bcs` | BCS of the payload, for checking |
| `signature` | Ed25519 over BCS(IntentMessage { intent: 1, timestamp_ms: fetched_at, payload }) |
| `public_key` | The enclave's key; must equal the registered `Enclave<CHEK>.pk` |
| `snapshot_json` | Upload these exact bytes to Walrus; `payload.snapshot_hash` is their Blake2b-256 |
| `posts_read`, `users_read`, `llm_calls` | Cost record (NFR3) |

`packages/core`'s `verifySnapshotResponse` runs every check the Verify page runs.

## Errors

| Status | When | Runner action |
| --- | --- | --- |
| 400 | Invalid request or rules | Bug: alert, don't retry |
| 401 | Missing or wrong `X-Chek-Auth` | Config error: alert |
| 409 | Earlier than close + 30 s, or later than close + 6 h | Wait / let the campaign expire |
| 502 | X, the Sui node or the LLM failed after 5 tries | Retry with backoff inside the window |
| 503 | Another snapshot is running | Retry shortly |

The same request body within an hour returns the cached result (no second X bill).
`request_counter` counts snapshots computed since the enclave started.

## How the snapshot is made

1. `GET /2/tweets/{post_id}` (author, created_at, conversation_id, links).
2. Full-archive search on `conversation_id`, in 6-hour slices from `opened_at`, every page of a
   slice, stopping after the slice in which `max_replies_read` replies have been collected.
   Replies are kept with author facts, media presence and links; text is used by the filter and
   the judge only and never leaves the enclave.
3. Post linkage from the post's links and the author's own replies before close.
4. SuiNS names of replies that pass every other rule, through the pinned Sui node.
5. The rules filter (`chek_core::filter`, docs/rules-reference.md).
6. Judged Draw: one Messages API call per eligible reply up to `max_judged` (8 at a time), with
   structured output `{pass, reason}`, effort low, no sampling parameters and no model fallback.
   The entry's text is quoted as a JSON string inside `<entry>`; its first image, from
   `pbs.twimg.com` only and at most 5 MB, is attached. A refusal or unreadable reply is an
   `AI_FAIL`; an outage fails the whole snapshot.
7. Snapshot document (canonical JSON), its hash, the entrants' Merkle root, the payload and the
   signature.

## Decisions to confirm

- **30-second settle time.** X search requires `end_time` at least 10 s in the past, so the
  enclave refuses snapshots until 30 s after close (the spec says "after close").
- **No model fallback in the judge.** Every verdict comes from the model recorded in the snapshot
  and the build; a refusal is an `AI_FAIL` with the reason "The model declined to judge this
  entry."
- **Authors X does not expand** (suspended or protected accounts) are treated as new accounts with
  no followers, so the account-age and follower rules exclude them.
- **Deleted post** (F17): the post lookup fails, the snapshot returns 502, and the campaign expires
  after 48 h with a refund.
