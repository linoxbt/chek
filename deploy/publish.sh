#!/usr/bin/env bash
# Publishes move/chek together with the vendored Nautilus enclave package and records the new
# object IDs in deploy/<network>.json. Needs: sui (active env = <network>, funded address), jq.
set -euo pipefail
NETWORK="${1:?usage: deploy/publish.sh <testnet|mainnet>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/$NETWORK.json"
[ ! -e "$OUT" ] || { echo "$OUT already records a deployment; move it aside first" >&2; exit 1; }
ACTIVE="$(sui client active-env)"
[ "$ACTIVE" = "$NETWORK" ] || { echo "sui client is on '$ACTIVE'; run: sui client switch --env $NETWORK" >&2; exit 1; }

TMP="$(mktemp)"
(cd "$ROOT/move/chek" && sui client publish --with-unpublished-dependencies --gas-budget 1000000000 --json) > "$TMP"

jq --arg net "$NETWORK" --arg sender "$(sui client active-address)" '
  def created(suffix): [.objectChanges[] | select(.type == "created" and (.objectType | endswith(suffix))) | .objectId];
  {
    network: $net,
    publisher: $sender,
    publish_digest: .digest,
    package_id: ([.objectChanges[] | select(.type == "published") | .packageId] | first),
    config_id: (created("::config::Config") | first),
    admin_cap_id: (created("::config::AdminCap") | first),
    pcr_admin_id: (created("::enclave_app::PcrAdmin") | first),
    upgrade_cap_ids: created("::package::UpgradeCap"),
    enclave_config_id: null,
    pcrs: null,
    enclaves: []
  }' "$TMP" > "$OUT"
rm -f "$TMP"
echo "Published. Recorded in $OUT:"
cat "$OUT"
