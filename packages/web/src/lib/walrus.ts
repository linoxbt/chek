import { config } from "./config.ts";

/** Uploads through the Testnet publisher (Mainnet needs your own publisher or an upload relay). */
export async function putBlob(data: Uint8Array): Promise<string> {
  const resp = await fetch(`${config.walrusPublisher}/v1/blobs?epochs=${config.walrusEpochs}`, { method: "PUT", body: new Blob([data as BlobPart]) });
  if (!resp.ok) throw new Error(`Walrus upload failed (HTTP ${resp.status})`);
  const j = (await resp.json()) as { newlyCreated?: { blobObject: { blobId: string } }; alreadyCertified?: { blobId: string } };
  const id = j.newlyCreated?.blobObject.blobId ?? j.alreadyCertified?.blobId;
  if (!id) throw new Error("Walrus returned no blob ID");
  return id;
}

export async function getBlob(blobId: string): Promise<Uint8Array> {
  const resp = await fetch(`${config.walrusAggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
  if (!resp.ok) throw new Error(`Walrus read failed (HTTP ${resp.status})`);
  return new Uint8Array(await resp.arrayBuffer());
}
