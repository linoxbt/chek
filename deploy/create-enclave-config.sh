#!/usr/bin/env bash
# Creates the single EnclaveConfig<CHEK> from a release build's PCRs (out/nitro.pcrs).
# Refuses all-zero PCRs: those come from debug builds, whose attestations prove nothing.
set -euo pipefail
NETWORK="${1:?usage: deploy/create-enclave-config.sh <network> <path/to/nitro.pcrs>}"
PCRS_FILE="${2:?usage: deploy/create-enclave-config.sh <network> <path/to/nitro.pcrs>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/$NETWORK.json"
PKG="$(jq -r .package_id "$OUT")"
PCR_ADMIN="$(jq -r .pcr_admin_id "$OUT")"

PCR0="$(sed -n 's/^PCR0=//p' "$PCRS_FILE")"
PCR1="$(sed -n 's/^PCR1=//p' "$PCRS_FILE")"
PCR2="$(sed -n 's/^PCR2=//p' "$PCRS_FILE")"
for v in "$PCR0" "$PCR1" "$PCR2"; do
  [[ "$v" =~ ^[0-9a-f]{96}$ ]] || { echo "PCR values must be 48-byte hex; got '$v'" >&2; exit 1; }
  [[ "$v" =~ ^0+$ ]] && { echo "All-zero PCRs: this is a debug build. Build with 'make' and run with 'make run'." >&2; exit 1; }
done

TMP="$(mktemp)"
sui client call --package "$PKG" --module enclave_app --function create_config \
  --args "$PCR_ADMIN" "chek-enclave" "0x$PCR0" "0x$PCR1" "0x$PCR2" \
  --gas-budget 100000000 --json > "$TMP"
EC="$(jq -r '[.objectChanges[] | select(.type == "created" and (.objectType | contains("::enclave::EnclaveConfig<"))) | .objectId] | first' "$TMP")"
rm -f "$TMP"
jq --arg ec "$EC" --arg p0 "$PCR0" --arg p1 "$PCR1" --arg p2 "$PCR2" \
  '.enclave_config_id = $ec | .pcrs = {version: 0, pcr0: $p0, pcr1: $p1, pcr2: $p2}' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "EnclaveConfig<CHEK>: $EC"
