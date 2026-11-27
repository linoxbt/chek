/** Build-time configuration (Vite env). With no PACKAGE_ID the app runs on built-in demo data. */
export interface WebConfig {
  network: "testnet" | "mainnet";
  grpcUrl: string;
  packageId: string;
  configId: string;
  enclaveConfigId: string;
  enclaveId: string;
  walrusPublisher: string;
  walrusAggregator: string;
  walrusEpochs: number;
  demo: boolean;
  /** Origin of giveaway links in posts (MD9). */
  linkOrigin: string;
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};

export const config: WebConfig = {
  network: env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet",
  grpcUrl: env.VITE_SUI_GRPC_URL ?? (env.VITE_NETWORK === "mainnet" ? "https://fullnode.mainnet.sui.io:443" : "https://fullnode.testnet.sui.io:443"),
  packageId: env.VITE_PACKAGE_ID ?? "",
  configId: env.VITE_CONFIG_ID ?? "",
  enclaveConfigId: env.VITE_ENCLAVE_CONFIG_ID ?? "",
  enclaveId: env.VITE_ENCLAVE_ID ?? "",
  walrusPublisher: env.VITE_WALRUS_PUBLISHER ?? "https://publisher.walrus-testnet.walrus.space",
  walrusAggregator: env.VITE_WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: Number(env.VITE_WALRUS_EPOCHS ?? 53),
  demo: env.VITE_DEMO === "1" || !env.VITE_PACKAGE_ID,
  linkOrigin: env.VITE_LINK_ORIGIN ?? "https://chek.app",
};
