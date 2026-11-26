# Chek

Provably fair X (Twitter) giveaways on Sui. The prize is escrowed on-chain before entries open, an
attested Nautilus enclave turns the replies into a frozen entrant list, Sui's on-chain randomness
picks the winners, and prizes are paid straight to the addresses entrants posted. Anyone can check
every step.

The full design is in the Chek Build Specification v1.0.

## Build phases

| Phase | Dates (2026) | Status |
| --- | --- | --- |
| 0. Foundations: repo, shared encoding library, test vectors, CI | 26–27 Nov | Done |
| 1. Move package | 27 Nov – 2 Dec | Contract and 88 unit tests pass; open: gas-equality check (AC10, needs Testnet) and a randomized conservation test |
| 2. Enclave spike and go/no-go | 26 Nov – 2 Dec | Not started |
| 3. Snapshot engine | 3–9 Dec | Not started |
| 4. Runner | 6–11 Dec | Not started |
| 5. Judged Draw and web app | 10–14 Dec | Not started |
| 6. Testnet hardening | 12–16 Dec | Not started |
| 7. Mainnet and submission | 16–28 Dec | Not started |

## Repository layout

```
packages/core/        TypeScript: canonical rules JSON, Blake2b-256, BCS leaves, Merkle tree, Move error map
enclave/chek-core/    Rust twin of packages/core, used by the Nautilus enclave
move/chek/            Sui Move package: config, enclave_app, snapshot, merkle, campaign
move/enclave/         Vendored Nautilus enclave package
fixtures/vectors.json Shared test vectors all three must reproduce
docs/                 Rules and encoding reference, contract reference
```

Later phases add `packages/web`, `packages/runner`, `enclave/chek-enclave` and `deploy/`, as laid
out in section 18 of the spec.

## Develop

Requirements: Node 20+, pnpm 10, Rust stable, and the Sui CLI for Move.

```sh
pnpm install
pnpm typecheck && pnpm test          # TypeScript
(cd enclave/chek-core && cargo test)  # Rust
(cd move/chek && sui move test)       # Move
pnpm vectors                          # regenerate shared vectors after changing an encoding
```

## License

MIT
