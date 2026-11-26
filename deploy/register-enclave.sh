#!/usr/bin/env bash
# Registers a running enclave on-chain from its attestation document (the same PTB as Nautilus's
# register_enclave.sh) and records the Enclave object and its public key.
set -euo pipefail
NETWORK="${1:?usage: deploy/register-enclave.sh <network> <enclave url, e.g. http://1.2.3.4:3000>}"
URL="${2:?usage: deploy/register-enclave.sh <network> <enclave url>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/$NETWORK.json"
PKG="$(jq -r .package_id "$OUT")"
EC="$(jq -r .enclave_config_id "$OUT")"
[ "$EC" != "null" ] || { echo "No enclave_config_id in $OUT; run create-enclave-config.sh first" >&2; exit 1; }

ATT="$(curl -sf "$URL/get_attestation" | jq -r .attestation)"
PK="$(curl -sf "$URL/health_check" | jq -r .pk)"
[ -n "$ATT" ] && [ "$ATT" != "null" ] || { echo "Empty attestation from $URL" >&2; exit 1; }
ARR="$(python3 -c 'import sys; h = sys.argv[1]; print("[" + ", ".join(f"{int(h[i:i+2], 16)}u8" for i in range(0, len(h), 2)) + "]")' "$ATT")"

TMP="$(mktemp)"
sui client ptb \
  --assign v "vector$ARR" \
  --move-call "0x2::nitro_attestation::load_nitro_attestation" v @0x6 \
  --assign doc \
  --move-call "$PKG::enclave::register_enclave<$PKG::enclave_app::CHEK>" "@$EC" doc \
  --gas-budget 100000000 --json > "$TMP"
EID="$(jq -r '[.objectChanges[] | select(.type == "created" and (.objectType | contains("::enclave::Enclave<"))) | .objectId] | first' "$TMP")"
DIGEST="$(jq -r .digest "$TMP")"
rm -f "$TMP"
jq --arg id "$EID" --arg pk "$PK" --arg d "$DIGEST" --arg url "$URL" \
  '.enclaves += [{enclave_id: $id, public_key: $pk, register_digest: $d, url: $url, config_version: .pcrs.version}]' \
  "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "Enclave<CHEK>: $EID (public key $PK)"
