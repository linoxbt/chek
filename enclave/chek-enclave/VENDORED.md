# Vendored Nautilus template

Copied from `MystenLabs/nautilus` at commit `0104d627c66cd2d27a46f3c17af537e3c4576d74`
(14 Aug 2026), Apache-2.0 (`LICENSE`).

Kept unchanged: `Containerfile`, `Makefile`, `configure_enclave.sh`, `expose_enclave.sh`,
`register_enclave.sh`, `reset_enclave.sh`, `update.sh`, `rust-toolchain.toml`, `deny.toml`,
`src/nautilus-server/run.sh`, `src/nautilus-server/traffic_forwarder.py`,
`src/nautilus-server/src/common.rs`.

Changed for Chek:

- `src/nautilus-server/Cargo.toml`: the example apps' features and optional dependencies are
  removed; one feature, `chek`. `Cargo.lock` lost only the entries those dependencies used, so
  the container's `cargo build --locked` resolves the same versions as upstream.
- `src/nautilus-server/src/lib.rs`, `main.rs`: `AppState` carries a `Secrets` object parsed from
  the `CHEK_SECRETS` environment variable instead of a single `API_KEY`; routes are
  `/get_attestation`, `/health_check` and the Chek app's endpoints. No CORS layer.
- `src/nautilus-server/src/apps/chek/`: the Chek app and its `allowed_endpoints.yaml`.
- The example apps (`weather-example`, `twitter-example`, `seal-example`) are not copied.
