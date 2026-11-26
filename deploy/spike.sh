#!/usr/bin/env bash
# Runs the Phase 2 go/no-go: asks the enclave to reach X and Anthropic, then checks the signed
# result against the enclave's public key. Costs one X Post read, one search page and one
# small Messages call.
set -euo pipefail
URL="${1:?usage: deploy/spike.sh <enclave url> <public X post id>}"
POST_ID="${2:?usage: deploy/spike.sh <enclave url> <public X post id>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="$ROOT/deploy/spike"
mkdir -p "$OUTDIR"

echo "health_check:"
curl -sf "$URL/health_check" | tee "$OUTDIR/health-$STAMP.json" | jq .
PK="$(jq -r .pk "$OUTDIR/health-$STAMP.json")"

curl -sf -H 'Content-Type: application/json' -d "{\"post_id\": \"$POST_ID\"}" "$URL/spike" > "$OUTDIR/spike-$STAMP.json"
jq . "$OUTDIR/spike-$STAMP.json"
pnpm --dir "$ROOT" --filter @chek/core verify-spike "$OUTDIR/spike-$STAMP.json" "$PK"
