# Runner

`packages/runner` moves every giveaway from close to payout. It is a convenience, not a trust
point: every step it takes can be taken by anyone, and if it stops, campaigns refund after 48 h.

## What it does each tick (default every 15 s)

1. Reads new `Created` events for the package and adds those campaigns.
2. For each active campaign, reads its object from Sui and takes the next step (`src/plan.ts`):

| Campaign state | Step |
| --- | --- |
| OPEN, before close + 30 s | wait |
| OPEN, close + 30 s to close + 6 h | ask the enclave for a snapshot |
| OPEN, holding a signed snapshot, before close + 48 h | `commit_snapshot` |
| OPEN, after close + 48 h | `expire` |
| COMMITTED | `draw` |
| DRAWN | `distribute_*` for unpaid ranks (50 per transaction), then `reclaim_unused*` |
| CANCELLED, EXPIRED, or SETTLED with no entrants, object prizes left | `refund_objects` |
| anything else settled | retire the campaign |

Up to six steps per campaign per tick, so a healthy close-to-paid run takes one tick (NFR2).

## What it checks before committing

- The rules blob on Walrus hashes to the campaign's `rules_hash` (before calling the enclave).
- The enclave's public key is the registered `Enclave<CHEK>`'s key, and that enclave's config
  version is the one the campaign pinned (otherwise `commit_snapshot` would abort EWrongEnclave).
- Every Verify-page check passes (`verifySnapshotResponse`): signature, payload bytes, document
  hash, document ↔ payload fields, entrants' Merkle root.
- The payload's campaign fields equal the campaign's.
- The snapshot document reads back from Walrus with the same hash.

## Failures

Retries back off from 1 s, doubling, up to 10 min. After 6 failures in a row, or at once for a
permanent problem (a check above failing, HTTP 400/401 from the enclave), it alerts once
(log, and Telegram when configured). A 409 from the enclave (too early) waits a minute. A Move
abort meaning someone else already took the step (EWrongState, EPaid, ENothingUnused) is not a
failure. A held snapshot survives transient commit failures and is dropped on an abort that can
never succeed (EBadSig, EMismatch, EWindow, EWrongEnclave).

## State

`STATE_FILE` (JSON) caches the event cursor, the campaign list and snapshots held for commit.
It is not a record: chain plus Walrus can rebuild everything, and losing it costs at most one
repeated enclave request (cached by the enclave for an hour). No Redis: see the note below.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `NETWORK` | | `testnet` |
| `PACKAGE_ID`, `ENCLAVE_ID` | yes | from `deploy/<network>.json` (`package_id`, last `enclaves[].enclave_id`) |
| `ENCLAVE_URL`, `ENCLAVE_HMAC_KEY` | yes | the enclave's private address; the key in its secret |
| `RUNNER_KEY` | yes | `suiprivkey…` of a funded address (it pays gas) |
| `SUI_GRPC_URL` | | public full node for the network |
| `WALRUS_PUBLISHER`, `WALRUS_AGGREGATOR` | publisher on Mainnet | public Testnet endpoints |
| `WALRUS_EPOCHS` | | 53 on Testnet (its maximum), 26 on Mainnet (~1 year) |
| `POLL_MS`, `STATE_FILE`, `PORT` | | 15000, `./runner-state.json`, 8080 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | | alerts to Telegram |

Run with `pnpm --filter @chek/runner start`. `GET /health` and `GET /status` (per-campaign
state, last step, last error; no secrets) are served on `PORT`.

## Decisions to confirm

- **No Redis/BullMQ (spec section 17).** Every step reads chain state first and repeating one is
  harmless, so one runner needs no job queue or locks. Two runners would only duplicate
  transactions that abort. Add a lock if you ever run several.
- **gRPC, not JSON-RPC.** `@mysten/sui` 3.x has removed JSON-RPC, so the runner uses
  `SuiGrpcClient`. The enclave's SuiNS lookup still uses JSON-RPC (A4): if full nodes drop it too,
  that lookup moves to GraphQL or gRPC before Mainnet.
- **Blob IDs on-chain** (`rules_blob`, `blob_id`) are the UTF-8 bytes of the Walrus blob ID string.
