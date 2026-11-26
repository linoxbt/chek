# Phase 2: enclave spike and go/no-go

**Question it answers (assumption A1):** can a Nautilus enclave on AWS Nitro call `api.x.com`
and `api.anthropic.com` over TLS terminated inside the enclave? It also checks A10 (full-archive
search on `conversation_id` with a pay-per-use X account). **Gate: 2 Dec 2026.**

How the template answers A1 by design: inside the enclave, `/etc/hosts` points each allowed
domain at a loopback address; `traffic_forwarder.py` carries those TCP bytes over VSOCK to the
host's `vsock-proxy`, which connects to the real domain. `reqwest` runs the TLS handshake inside
the enclave against the CA bundle baked into the image, so the host relays ciphertext only. The
spike proves it end to end and returns the result signed by the enclave's attested key.

## What you need

| Item | Notes |
| --- | --- |
| AWS account with Nitro Enclaves | `configure_enclave.sh` launches the EC2 instance (see Nautilus `UsingNautilus.md`) |
| AWS CLI, configured | Used by `configure_enclave.sh` to create the instance and read the secret |
| X developer account, pay-per-use | Bearer token, with a spending cap set (Testnet cap: $50) |
| Anthropic API key | With a monthly limit |
| Sui CLI on Testnet, funded address | For publishing and registration |
| `jq`, `python3`, `curl`, Node 20 + pnpm | On the machine running `deploy/*.sh` |

## Steps

1. **One secret for everything.** Create an AWS Secrets Manager secret whose value is a JSON
   object:

   ```json
   {"X_BEARER_TOKEN": "…", "ANTHROPIC_API_KEY": "…"}
   ```

2. **Launch the instance.** From `enclave/chek-enclave`:

   ```sh
   export API_ENV_VAR_NAME=CHEK_SECRETS
   sh configure_enclave.sh chek     # answer "y" to use a secret, then "existing" and its ARN
   ```

3. **Build and run a release enclave** on the instance (clone this repository there first):

   ```sh
   cd enclave/chek-enclave
   make ENCLAVE_APP=chek            # writes out/nitro.eif and out/nitro.pcrs
   make run                         # not run-debug: debug PCRs are all zeros
   sh expose_enclave.sh             # sends secrets.json and exposes port 3000
   ```

   Keep port 3000 reachable only from your own IP in the security group: `/spike` spends API credit.

4. **Run the spike** from your machine:

   ```sh
   deploy/spike.sh http://<instance-ip>:3000 <id of any public X post>
   ```

   It prints `health_check` (every allowed host should be `true`), the signed report, and the
   go/no-go checks. Results are kept in `deploy/spike/`.

5. **Register on Testnet** (needs a release build):

   ```sh
   sui client switch --env testnet
   deploy/publish.sh testnet
   deploy/create-enclave-config.sh testnet enclave/chek-enclave/out/nitro.pcrs
   deploy/register-enclave.sh testnet http://<instance-ip>:3000
   ```

   `deploy/testnet.json` then holds the package, config, enclave config and Enclave IDs. Commit it.
   `publish.sh` uses `--with-unpublished-dependencies` so the vendored `enclave` module ships
   inside the Chek package; it has not been run against Sui 1.85 yet, so check the first run's output.

6. **Reproducibility.** Run `make ENCLAVE_APP=chek` on a second machine and compare
   `out/nitro.pcrs`. They must be identical.

## Go/no-go

| Check | Go when | If it fails |
| --- | --- | --- |
| Signature | Report verifies against the `pk` from `/health_check` | Wrong key or tampered response: stop and investigate |
| A1, X | `x_post_status` = 200 | 0 = TLS or proxy failure (check `health_check` and the vsock-proxy allowlist); 401/403 = token or account access |
| A1, Anthropic | `anthropic_status` = 200 | 0 = TLS or proxy failure; 401 = key; 400 = request shape |
| A10 | `x_search_status` = 200 | Not a no-go: fall back to recent search and cap giveaways at 7 days |
| Registration | `register-enclave.sh` creates an `Enclave<CHEK>` | Attestation or PCR mismatch: rebuild, re-run `create-enclave-config.sh` on a fresh package |

**No-go fallback (decide before the package is made immutable):** an "operator-signed" mode
with its own on-chain label, where the runner's key signs snapshots and the Verify page says so.

## After a go

- Record the result (the signed spike JSON and `deploy/testnet.json`) in the repository.
- Phase 3 replaces `/spike` with `/snapshot`, which needs the HMAC check from MD14 and AC22.
