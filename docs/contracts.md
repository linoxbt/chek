# Move contracts

The `chek` package (`move/chek`) plus a vendored copy of the Nautilus `enclave` package
(`move/enclave`). Both are made immutable before Mainnet.

| Module | Holds |
| --- | --- |
| `chek::config` | `Config` (fee, fee recipient, entrant/judged/read caps, pause) and `AdminCap` |
| `chek::enclave_app` | The `CHEK` type tag and `PcrAdmin`, which holds the only `Cap<CHEK>` |
| `chek::snapshot` | `SnapshotPayload`, the enclave-signed message, and its signature check |
| `chek::merkle` | Leaf and node hashing, proof verification |
| `chek::campaign` | `Campaign<C>`, `OrganizerCap`, the whole giveaway lifecycle |

## Lifecycle

| From | Call | Who | To |
| --- | --- | --- | --- |
| — | `create` → `fund_coin` / `deposit_object` → `share`, one transaction | Organizer | DRAFT |
| DRAFT | `cancel` | Organizer | CANCELLED (coins back now; objects via `refund_objects`) |
| DRAFT | `open(post_id)` | Organizer | OPEN |
| OPEN | `commit_snapshot` | Anyone with a valid enclave signature | COMMITTED, or SETTLED if n = 0 |
| OPEN | `expire` (after close + 48 h) | Anyone | EXPIRED |
| COMMITTED | `draw` (private entry, Sui Random) | Anyone | DRAWN |
| DRAWN | `distribute_coin` / `distribute_object`, `reclaim_unused` / `reclaim_unused_objects` | Anyone | SETTLED once every rank is paid and nothing unused is left |
| CANCELLED, EXPIRED, SETTLED with n = 0 | `refund_objects` | Anyone | (objects to the organizer) |

Abort codes 1–16 are listed in `packages/core/src/errors.ts`.

## Where the code goes beyond the spec text

These follow from the accepted review suggestions or from building them; the spec should be
updated to match.

- **One enclave config.** `Cap<CHEK>` lives inside `PcrAdmin`, which allows `create_config` once
  and then only `update_pcrs`. Without this the cap holder could create a second
  `EnclaveConfig<CHEK>` whose version number matches a campaign's pin.
- **Caps in the signed payload.** `SnapshotPayload` also carries `max_entrants`, `max_judged` and
  `max_replies_read`, and `commit_snapshot` requires them to equal the campaign's copies, so the
  runner cannot ask the enclave to apply different caps.
- **More commit checks.** `n ≤ max_entrants`, `n ≤ replies_seen ≤ max_replies_read`, `n ≤
  max_judged` for Judged Draw, root and snapshot hash are 32 bytes, and `fetched_at ≤ now`.
- **`refund_objects` replaces `cancel_objects`.** One function returns object prizes after a
  cancel, an expiry or a snapshot with no entrants.
- **Object prizes use `Campaign<SUI>`.** `create` rejects any other coin type for object prizes.
- **One return event.** `Reclaimed` is emitted for every prize returned to the organizer.
- **Draw cost.** The Fisher–Yates overrides are a local list with one entry per round and every
  lookup scans all of it. A lookup's two branches differ by a few instructions, far below Sui's
  gas-bucket granularity.
