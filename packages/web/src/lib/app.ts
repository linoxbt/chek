import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { config } from "./config.ts";
import { ChainReader, type Reader } from "./reader.ts";
import { DemoReader } from "./demo.ts";

const URLS = { testnet: "https://fullnode.testnet.sui.io:443", mainnet: "https://fullnode.mainnet.sui.io:443" } as const;

export const dAppKit = createDAppKit({
  networks: [config.network],
  defaultNetwork: config.network,
  // Demo mode makes no outside calls (the Slush web wallet fetches its metadata on load).
  ...(config.demo ? { slushWalletConfig: null } : {}),
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: network === config.network ? config.grpcUrl : URLS[network] }),
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

export const reader: Reader = config.demo ? new DemoReader() : new ChainReader();

export const chainIds = { packageId: config.packageId, configId: config.configId, enclaveConfigId: config.enclaveConfigId };

/** The shared object a create transaction made: the Campaign (the cap is address-owned). */
export function createdCampaignId(effects: { changedObjects: { objectId: string; idOperation: string; outputOwner: { $kind: string } | null }[] }): string | null {
  return effects.changedObjects.find((o) => o.idOperation === "Created" && o.outputOwner?.$kind === "Shared")?.objectId ?? null;
}

export const fmtSui = (mist: bigint) => {
  const whole = mist / 1_000_000_000n;
  const frac = (mist % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export function parseSui(s: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(s.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
}

export const short = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
export const explorerTx = (d: string) => `https://suiscan.xyz/${config.network}/tx/${d}`;
export const explorerObj = (id: string) => `https://suiscan.xyz/${config.network}/object/${id}`;
export const xPost = (id: string) => `https://x.com/i/status/${id}`;
