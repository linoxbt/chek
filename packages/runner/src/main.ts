import { createServer } from "node:http";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { GrpcChain, HttpEnclave, OperatorAlerts, WalrusHttp } from "./adapters.ts";
import { loadConfig } from "./config.ts";
import { Runner } from "./runner.ts";
import { FileState } from "./state.ts";

const cfg = loadConfig();
const client = new SuiGrpcClient({ network: cfg.network, baseUrl: cfg.suiGrpcUrl });
const signer = Ed25519Keypair.fromSecretKey(cfg.runnerKey);
const alerts = new OperatorAlerts(cfg.telegram);
const runner = new Runner(
  new GrpcChain(client, cfg.packageId, signer),
  new HttpEnclave(cfg.enclaveUrl, cfg.enclaveHmacKey),
  new WalrusHttp(cfg.walrusPublisher, cfg.walrusAggregator, cfg.walrusEpochs),
  alerts,
  new FileState(cfg.stateFile),
  { ids: { packageId: cfg.packageId, enclaveId: cfg.enclaveId } },
);

let lastTick = 0;
let lastTickError: string | null = null;

async function loop() {
  try {
    await runner.tick();
    lastTickError = null;
  } catch (e) {
    lastTickError = e instanceof Error ? e.message : String(e);
    console.error(`[tick] ${lastTickError}`);
  }
  lastTick = Date.now();
  setTimeout(loop, cfg.pollMs);
}

// /health for the platform; /status for the operator (no secrets in either).
createServer((req, res) => {
  const body =
    req.url === "/status"
      ? { network: cfg.network, signer: signer.toSuiAddress(), lastTick, lastTickError, campaigns: Object.fromEntries(runner.view) }
      : { ok: lastTickError === null, lastTick };
  res.writeHead(req.url === "/status" || req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}).listen(cfg.port, () => console.log(`runner ${signer.toSuiAddress()} on ${cfg.network}, status on :${cfg.port}`));

void loop();
