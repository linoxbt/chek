import { createHmac } from "node:crypto";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Keypair } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import type { SnapshotResponse } from "@chek/core";
import { EnclaveBcs, parseCampaign, type Campaign } from "./campaign.ts";
import { EnclaveError, TxFailed, type Alerts, type BlobStore, type Chain, type Enclave, type SnapshotRequest } from "./ports.ts";

export class GrpcChain implements Chain {
  constructor(
    private readonly client: SuiGrpcClient,
    private readonly packageId: string,
    private readonly signer: Keypair,
  ) {}

  async newCampaigns(cursor: string | null) {
    const ids: string[] = [];
    let after = cursor;
    for (;;) {
      const page = await this.client.listEvents({
        filter: { eventType: `${this.packageId}::campaign::Created` },
        after,
        limit: 50,
      });
      // Created's first field is the campaign ID (32 bytes).
      for (const e of page.events) ids.push(`0x${Buffer.from(e.bcs.slice(0, 32)).toString("hex")}`);
      after = page.endCursor ?? after;
      if (!page.hasNextPage) break;
    }
    return { ids, cursor: after };
  }

  async campaign(id: string): Promise<Campaign> {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true } });
    return parseCampaign(object.type, object.content);
  }

  async enclave(id: string) {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true } });
    const e = EnclaveBcs.parse(object.content);
    return { publicKey: Buffer.from(e.pk).toString("hex"), configVersion: Number(e.config_version) };
  }

  async objectsLeft(campaignId: string) {
    const r = await this.client.listDynamicFields({ parentId: campaignId, limit: 1 });
    return r.dynamicFields.length > 0;
  }

  async execute(tx: Transaction): Promise<string> {
    const result = await this.client.signAndExecuteTransaction({ transaction: tx, signer: this.signer });
    if (result.$kind === "FailedTransaction") {
      const err = result.FailedTransaction.status.error;
      const abort = err && "MoveAbort" in err && err.MoveAbort ? Number((err.MoveAbort as { abortCode: string | number }).abortCode) : undefined;
      throw new TxFailed(err?.message ?? "transaction failed", abort);
    }
    await this.client.waitForTransaction({ result });
    return result.Transaction.digest;
  }
}

/** HMAC-SHA256 of the exact body under the shared key, hex (docs/snapshot-api.md). */
export function authTag(key: string, body: string): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

export class HttpEnclave implements Enclave {
  constructor(
    private readonly url: string,
    private readonly hmacKey: string,
  ) {}

  async snapshot(req: SnapshotRequest): Promise<SnapshotResponse> {
    const body = JSON.stringify(req);
    const resp = await fetch(`${this.url}/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-chek-auth": authTag(this.hmacKey, body) },
      body,
      signal: AbortSignal.timeout(70 * 60 * 1000), // a 1 000-entry Judged Draw may take up to an hour (NFR1)
    });
    const json = (await resp.json().catch(() => ({}))) as { error?: string };
    if (!resp.ok) throw new EnclaveError(resp.status, json.error ?? resp.statusText);
    return json as unknown as SnapshotResponse;
  }
}

export class WalrusHttp implements BlobStore {
  constructor(
    private readonly publisher: string,
    private readonly aggregator: string,
    private readonly epochs: number,
  ) {}

  async put(data: Uint8Array): Promise<string> {
    const resp = await fetch(`${this.publisher}/v1/blobs?epochs=${this.epochs}`, { method: "PUT", body: Buffer.from(data) });
    if (!resp.ok) throw new Error(`Walrus publisher: HTTP ${resp.status}`);
    const j = (await resp.json()) as { newlyCreated?: { blobObject: { blobId: string } }; alreadyCertified?: { blobId: string } };
    const id = j.newlyCreated?.blobObject.blobId ?? j.alreadyCertified?.blobId;
    if (!id) throw new Error("Walrus publisher returned no blob ID");
    return id;
  }

  async get(blobId: string): Promise<Uint8Array> {
    const resp = await fetch(`${this.aggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
    if (!resp.ok) throw new Error(`Walrus aggregator: HTTP ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  }
}

/** Telegram when configured (spec: alerts to the operator's Telegram), always the log. */
export class OperatorAlerts implements Alerts {
  constructor(private readonly telegram?: { token: string; chatId: string }) {}

  async send(message: string) {
    console.error(`[alert] ${message}`);
    if (!this.telegram) return;
    await fetch(`https://api.telegram.org/bot${this.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.telegram.chatId, text: `Chek runner: ${message}` }),
    }).catch((e) => console.error(`[alert] Telegram failed: ${e}`));
  }
}
