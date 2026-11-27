# Web app (`packages/web`)

React + Vite. Pages:

The visual design follows the Veyra crypto template on the Framer Marketplace (dark ink-green surfaces, lime accent,
Clash Grotesk headings, Inter body, overview panel, numbered steps, lime call-to-action band), rebuilt in plain CSS
(`src/styles.css`) with Chek's own content, icons and components. No template assets or copy are used. Inter is bundled
from `@fontsource-variable/inter`; Clash Grotesk is free from Fontshare and loaded from their CDN.


| Route | Page |
| --- | --- |
| `/` | All giveaways (Created events → Campaign objects) |
| `/create` | Rules form → canonical rules uploaded to Walrus → one transaction: `create`, `fund_coin` or `deposit_object` × k, `share`, cap to sender |
| `/g/:id/post` | Giveaway link and suggested post text, then paste the post link → `open` (or `cancel`) |
| `/g/:id` | Verify page: plain-words result, winners, "Was I counted?", and every check |
| `/mine` | Giveaways whose `OrganizerCap` the connected wallet holds |

## Verify page checks

All run in the browser from Sui gRPC and the Walrus aggregator only (NFR8); Chek's servers are not asked.
The logic is `src/lib/verify-page.ts`.

1. **Rules**: the Walrus rules document is canonical and hashes to the `rules_hash` fixed at creation; mode matches.
2. **Enclave**: the committing enclave's `config_version` equals the version the giveaway pinned. PCRs are shown under Technical details.
3. **Signature**: checked on-chain by `commit_snapshot` (the page links the transaction). The signature itself is not stored on-chain, so the browser does not recheck it.
4. **Snapshot file**: hash matches `snapshot_hash`, canonical JSON, fields match the committed `SnapshotRef` and campaign, Merkle root rebuilt from the entrants.
5. **Link**: the post contains the giveaway link (`linked`). A missing link is a failed check: the draw can still be fair, but nothing ties the post to this giveaway.
6. **AI rubric** (Judged Draw): Blake2b-256 of the rubric prompt and the model match the document's `ai` block.
7. **Draw**: `min(k, n)` distinct winners, each with a valid Merkle proof against the root.
8. **Payouts**: each `Paid` event went to the winning entrant's address, for `per_winner` on coin prizes.

"Was I counted?" finds an entrant by @handle, address, or reply link. Excluded replies carry no handle in the
snapshot (privacy and size), so they are found by reply link only. The page shows the reason code in plain words.

## Configuration

Build-time `VITE_*` variables (`src/lib/config.ts`): `VITE_NETWORK`, `VITE_SUI_GRPC_URL`, `VITE_PACKAGE_ID`,
`VITE_CONFIG_ID`, `VITE_ENCLAVE_CONFIG_ID`, `VITE_WALRUS_PUBLISHER`, `VITE_WALRUS_AGGREGATOR`,
`VITE_WALRUS_EPOCHS`, `VITE_LINK_ORIGIN`.

With no `VITE_PACKAGE_ID`, or with `VITE_DEMO=1`, the app runs on **demo data**: a settled Judged Draw built from
`fixtures/snapshot-e2e.json`, which the Rust enclave pipeline produced in its tests, plus an open giveaway and a draft.
The checks run for real on that data. Demo mode makes no chain or Walrus calls (only the Clash Grotesk font loads from Fontshare) and turns off creating and opening.

## Known limits

- Rules are uploaded through the public Walrus Testnet publisher. Mainnet needs our own publisher or an upload relay (Phase 7).
- The bundle is about 920 kB (280 kB gzipped), mostly the wallet kit. Code-splitting can wait.
- Google/Enoki login (FR19) is not built; wallets connect through the wallet standard.
