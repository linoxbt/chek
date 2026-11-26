import { bcs } from "@mysten/bcs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fromHex } from "./hash.ts";

/** Intent scope of the enclave's Phase 2 spike report (snapshots use 1). */
export const SPIKE_INTENT = 2;

/** `SpikeReport` from enclave/chek-enclave/src/nautilus-server/src/apps/chek/mod.rs. */
export interface SpikeReport {
  post_id: string;
  x_post_status: number;
  post_author_id: string;
  conversation_is_post: boolean;
  x_search_status: number;
  x_search_results: number;
  anthropic_status: number;
  anthropic_stop_reason: string;
  model: string;
}

/** The JSON `/spike` returns: Nautilus's signed response plus unsigned diagnostics. */
export interface SpikeResponse {
  response: { intent: number; timestamp_ms: number; data: SpikeReport };
  signature: string;
  diagnostics?: unknown;
}

export const SpikeReportBcs = bcs.struct("SpikeReport", {
  post_id: bcs.u64(),
  x_post_status: bcs.u16(),
  post_author_id: bcs.u64(),
  conversation_is_post: bcs.bool(),
  x_search_status: bcs.u16(),
  x_search_results: bcs.u32(),
  anthropic_status: bcs.u16(),
  anthropic_stop_reason: bcs.string(),
  model: bcs.string(),
});

const SpikeIntentBcs = bcs.struct("IntentMessage", {
  intent: bcs.u8(),
  timestamp_ms: bcs.u64(),
  data: SpikeReportBcs,
});

export function spikeSigningBytes(r: SpikeResponse): Uint8Array {
  return SpikeIntentBcs.serialize(r.response).toBytes();
}

/**
 * Checks a spike result against the enclave's public key (from /health_check, or the attested
 * key registered on-chain). True only for an intent-2 message signed by that key.
 */
export function verifySpikeResponse(publicKeyHex: string, r: SpikeResponse): boolean {
  if (r.response.intent !== SPIKE_INTENT) return false;
  try {
    return ed25519.verify(fromHex(r.signature), spikeSigningBytes(r), fromHex(publicKeyHex));
  } catch {
    return false;
  }
}

export type GoNoGo = { go: boolean; checks: { name: string; pass: boolean; detail: string }[] };

/** The Phase 2 exit criteria applied to one verified spike report (docs/enclave-spike.md). */
export function goNoGo(publicKeyHex: string, r: SpikeResponse): GoNoGo {
  const d = r.response.data;
  const checks = [
    { name: "signature from the enclave key", pass: verifySpikeResponse(publicKeyHex, r), detail: "Ed25519 over BCS(IntentMessage)" },
    { name: "A1: X API over TLS from the enclave", pass: d.x_post_status === 200, detail: `GET /2/tweets → ${d.x_post_status}` },
    { name: "A10: full-archive search on conversation_id", pass: d.x_search_status === 200, detail: `search/all → ${d.x_search_status}, ${d.x_search_results} results` },
    { name: "A1: Anthropic API over TLS from the enclave", pass: d.anthropic_status === 200, detail: `POST /v1/messages → ${d.anthropic_status} (${d.anthropic_stop_reason || "no stop_reason"})` },
  ];
  // A10 failing alone is not a no-go: the spec's fallback is recent search with 7-day giveaways.
  const go = checks.filter((c) => !c.name.startsWith("A10")).every((c) => c.pass);
  return { go, checks };
}
