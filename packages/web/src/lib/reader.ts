import { bcs } from "@mysten/bcs";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { EnclaveBcs, fromHex, parseCampaign, toHex, type Campaign } from "@chek/core";
import { config } from "./config.ts";
import { getBlob } from "./walrus.ts";

/** Everything the pages read. The Verify page uses only the chain and Walrus (NFR8). */
export interface Reader {
  campaigns(): Promise<Campaign[]>;
  campaign(id: string): Promise<Campaign>;
  /** Organizer caps owned by `owner`: campaign ID → cap object ID. */
  organizerCaps(owner: string): Promise<Map<string, string>>;
  feeMist(): Promise<bigint>;
  enclaveConfig(): Promise<EnclaveConfigInfo>;
  enclave(id: string): Promise<{ publicKey: string; configVersion: number }>;
  history(campaignId: string): Promise<History>;
  blob(id: string): Promise<Uint8Array>;
}

export interface EnclaveConfigInfo {
  id: string;
  name: string;
  version: number;
  pcrs: [string, string, string];
}

export interface History {
  committedDigest: string | undefined;
  drawnDigest: string | undefined;
  payouts: { rank: number; to: string; amount: string; objectId: string | null; digest: string }[];
}

const Id = bcs.fixedArray(32, bcs.u8()).transform({
  input: (hex: string) => Array.from(fromHex(hex.replace(/^0x/, "").padStart(64, "0"))),
  output: (b: number[]) => `0x${toHex(Uint8Array.from(b))}`,
});
const ConfigBcs = bcs.struct("Config", { id: Id, fee_mist: bcs.u64() });
const EnclaveConfigBcs = bcs.struct("EnclaveConfig", {
  id: Id,
  name: bcs.string(),
  pcrs: bcs.tuple([bcs.vector(bcs.u8()), bcs.vector(bcs.u8()), bcs.vector(bcs.u8())]),
  capability_id: Id,
  version: bcs.u64(),
});
const CapBcs = bcs.struct("OrganizerCap", { id: Id, campaign_id: Id });
const PaidBcs = bcs.struct("Paid", { campaign_id: Id, rank: bcs.u16(), to: Id, amount: bcs.u64(), object_id: bcs.option(Id) });
const firstId = (b: Uint8Array) => `0x${toHex(b.slice(0, 32))}`;
const hexOf = (v: number[]) => toHex(Uint8Array.from(v));

export class ChainReader implements Reader {
  private readonly client = new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
  private readonly pkg = config.packageId;

  private async events(name: string) {
    const out = [];
    let after: string | null = null;
    for (;;) {
      const page = await this.client.listEvents({ filter: { eventType: `${this.pkg}::campaign::${name}` }, after, limit: 50 });
      out.push(...page.events);
      after = page.endCursor ?? after;
      if (!page.hasNextPage) return out;
    }
  }

  async campaigns() {
    const created = await this.events("Created");
    const ids = [...new Set(created.map((e) => firstId(e.bcs)))].reverse();
    const all: Campaign[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { objects } = await this.client.getObjects({ objectIds: ids.slice(i, i + 50), include: { content: true } });
      for (const o of objects) if (!(o instanceof Error)) all.push(parseCampaign(o.type, o.content));
    }
    return all;
  }

  async campaign(id: string) {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true } });
    return parseCampaign(object.type, object.content);
  }

  async organizerCaps(owner: string) {
    const caps = new Map<string, string>();
    const type = `${this.pkg}::campaign::OrganizerCap`;
    let page = await this.client.listOwnedObjects({ owner, type, include: { content: true } });
    for (;;) {
      for (const o of page.objects) caps.set(CapBcs.parse(o.content).campaign_id, o.objectId);
      if (!page.hasNextPage || !page.cursor) return caps;
      page = await this.client.listOwnedObjects({ owner, type, cursor: page.cursor, include: { content: true } });
    }
  }

  async feeMist() {
    const { object } = await this.client.getObject({ objectId: config.configId, include: { content: true } });
    return BigInt(ConfigBcs.parse(object.content).fee_mist);
  }

  async enclaveConfig(): Promise<EnclaveConfigInfo> {
    const { object } = await this.client.getObject({ objectId: config.enclaveConfigId, include: { content: true } });
    const c = EnclaveConfigBcs.parse(object.content);
    return { id: c.id, name: c.name, version: Number(c.version), pcrs: [hexOf(c.pcrs[0]), hexOf(c.pcrs[1]), hexOf(c.pcrs[2])] };
  }

  async enclave(id: string) {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true } });
    const e = EnclaveBcs.parse(object.content);
    return { publicKey: hexOf(e.pk), configVersion: Number(e.config_version) };
  }

  async history(campaignId: string): Promise<History> {
    const mine = <T extends { bcs: Uint8Array }>(es: T[]) => es.filter((e) => firstId(e.bcs) === campaignId);
    const [committed, drawn, paid] = await Promise.all([this.events("SnapshotCommitted"), this.events("Drawn"), this.events("Paid")]);
    return {
      committedDigest: mine(committed)[0]?.transactionDigest,
      drawnDigest: mine(drawn)[0]?.transactionDigest,
      payouts: mine(paid).map((e) => {
        const p = PaidBcs.parse(e.bcs);
        return { rank: p.rank, to: p.to, amount: p.amount, objectId: p.object_id, digest: e.transactionDigest };
      }),
    };
  }

  blob(id: string) {
    return getBlob(id);
  }
}
