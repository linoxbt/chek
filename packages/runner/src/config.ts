/** Runner configuration from the environment (spec section 17). Secrets come only from here. */
export interface Config {
  network: "testnet" | "mainnet";
  suiGrpcUrl: string;
  packageId: string;
  enclaveId: string;
  enclaveUrl: string;
  enclaveHmacKey: string;
  runnerKey: string;
  walrusPublisher: string;
  walrusAggregator: string;
  walrusEpochs: number;
  pollMs: number;
  stateFile: string;
  port: number;
  telegram?: { token: string; chatId: string };
}

const DEFAULTS = {
  testnet: {
    suiGrpcUrl: "https://fullnode.testnet.sui.io:443",
    walrusPublisher: "https://publisher.walrus-testnet.walrus.space",
    walrusAggregator: "https://aggregator.walrus-testnet.walrus.space",
  },
  mainnet: { suiGrpcUrl: "https://fullnode.mainnet.sui.io:443", walrusPublisher: "", walrusAggregator: "https://aggregator.walrus-mainnet.walrus.space" },
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} must be set`);
    return v;
  };
  const network = (env.NETWORK ?? "testnet") as Config["network"];
  if (network !== "testnet" && network !== "mainnet") throw new Error("NETWORK must be testnet or mainnet");
  const d = DEFAULTS[network];
  const walrusPublisher = env.WALRUS_PUBLISHER ?? d.walrusPublisher;
  // Mainnet has no public publisher (spec section 12): set WALRUS_PUBLISHER to your own or a relay.
  if (!walrusPublisher) throw new Error("WALRUS_PUBLISHER must be set on mainnet");
  return {
    network,
    suiGrpcUrl: env.SUI_GRPC_URL ?? d.suiGrpcUrl,
    packageId: need("PACKAGE_ID"),
    enclaveId: need("ENCLAVE_ID"),
    enclaveUrl: need("ENCLAVE_URL"),
    enclaveHmacKey: need("ENCLAVE_HMAC_KEY"),
    runnerKey: need("RUNNER_KEY"),
    walrusPublisher,
    walrusAggregator: env.WALRUS_AGGREGATOR ?? d.walrusAggregator,
    walrusEpochs: Number(env.WALRUS_EPOCHS ?? (network === "mainnet" ? 26 : 53)),
    pollMs: Number(env.POLL_MS ?? 15_000),
    stateFile: env.STATE_FILE ?? "./runner-state.json",
    port: Number(env.PORT ?? 8080),
    ...(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { telegram: { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID } } : {}),
  };
}
