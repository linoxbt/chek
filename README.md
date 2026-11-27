# Chek

Provably fair X (Twitter) giveaways on Sui. The prize is escrowed on-chain before entries open, an
attested Nautilus enclave turns the replies into a frozen entrant list, Sui's on-chain randomness
picks the winners, and prizes are paid straight to the addresses entrants posted. Anyone can check
every step.

The full design is in the Chek Build Specification v1.0.

**Live demo:** https://chek-giveaways.netlify.app (demo data until the Testnet deployment; the Verify checks run for real).

## Build phases

| Phase | Dates (2026) | Status |
| --- | --- | --- |
| 0. Foundations: repo, shared encoding library, test vectors, CI | 26–27 Nov | Done |
| 1. Move package | 27 Nov – 2 Dec | Contract and 88 unit tests pass; open: gas-equality check (AC10, needs Testnet) and a randomized conservation test |
| 2. Enclave spike and go/no-go | 26 Nov – 2 Dec | Code, scripts and runbook ready; the run needs AWS, X and Anthropic accounts ([runbook](docs/enclave-spike.md)) |
| 3. Snapshot engine | 3–9 Dec | Code complete and tested with mocks ([API](docs/snapshot-api.md)); live run needs the Phase 2 enclave and API accounts |
| 4. Runner | 6–11 Dec | Code complete, tested with fakes ([docs](docs/runner.md)); live run needs Testnet deploy and enclave |
| 5. Judged Draw and web app | 10–14 Dec | Web app and Verify page done, tested on demo data at 375 px and desktop ([docs](docs/web.md)); live use needs the Testnet deploy |
| 6. Testnet hardening | 12–16 Dec | Not started |
| 7. Mainnet and submission | 16–28 Dec | Not started |

## Repository layout

```
packages/core/        TypeScript: canonical rules JSON, Blake2b-256, BCS leaves, Merkle tree, Move error map, Verify checks
packages/web/         React app: create, post and open giveaways, public list, Verify page
packages/runner/      Node service: snapshot, Walrus upload, commit, draw, payouts, refunds
enclave/chek-enclave/ Nautilus template + Chek enclave app; src/chek-core is the Rust twin of packages/core
deploy/               Testnet/Mainnet publish, enclave config and registration scripts
move/chek/            Sui Move package: config, enclave_app, snapshot, merkle, campaign
move/enclave/         Vendored Nautilus enclave package
fixtures/vectors.json Shared test vectors all three must reproduce
docs/                 Rules and encoding reference, contract reference
```

## Develop

Requirements: Node 20+, pnpm 10, Rust stable, and the Sui CLI for Move.

```sh
pnpm install
pnpm typecheck && pnpm test          # TypeScript
(cd enclave/chek-enclave/src/chek-core && cargo test)  # Rust
(cd move/chek && sui move test)       # Move
pnpm --filter @chek/web dev           # web app on demo data (no env needed)
pnpm vectors                          # regenerate shared vectors after changing an encoding
```

## License

MIT
