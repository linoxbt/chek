/**
 * Usage: pnpm --filter @chek/core verify-spike <spike.json> <enclave public key hex>
 * spike.json is the body returned by POST /spike; the key is `pk` from GET /health_check.
 */
import { readFileSync } from "node:fs";
import { goNoGo, type SpikeResponse } from "../src/index.ts";

const [file, pk] = process.argv.slice(2);
if (!file || !pk) {
  console.error("usage: verify-spike <spike.json> <enclave public key hex>");
  process.exit(2);
}
const result = goNoGo(pk, JSON.parse(readFileSync(file, "utf8")) as SpikeResponse);
for (const c of result.checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
console.log(result.go ? "\nGO: the enclave reached X and Anthropic over TLS and signed the result." : "\nNO-GO: see the failed checks above.");
process.exit(result.go ? 0 : 1);
