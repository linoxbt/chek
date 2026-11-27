import {
  blake2b256,
  parseCanonicalRules,
  toHex,
  verifySnapshotResponse,
  type SnapshotDocument,
  type SnapshotResponse,
} from "@chek/core";
import { PRIZE_OBJECTS, Status, type Campaign } from "./campaign.ts";
import { plan, type Action } from "./plan.ts";
import { EnclaveError, TxFailed, type Alerts, type BlobStore, type Chain, type Enclave, type SnapshotRequest } from "./ports.ts";
import type { RunnerState, StateStore } from "./state.ts";
import { commitTx, distributeTx, drawTx, expireTx, reclaimTx, refundObjectsTx, type Ids } from "./txs.ts";

/** Retry delays: 1 s doubling, capped at 10 min (accepted spec change to section 7). */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 10 * 60 * 1000;
/** Alert once a campaign has failed this many times in a row. */
export const ALERT_AFTER = 6;
/** Steps taken for one campaign per tick, so close → paid usually happens in one tick. */
const STEPS_PER_TICK = 6;

/** Move abort codes (chek::campaign) after which a held snapshot can never be committed. */
const FATAL_COMMIT_ABORTS = new Set([9, 10, 11, 16]);
/** Abort codes that only mean another caller got there first. */
const STALE_ABORTS = new Set([4, 14, 15]);

export class Permanent extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface CampaignStatus {
  status: number;
  action: string;
  updatedAt: number;
  lastDigest?: string;
  lastError?: string;
  attempts: number;
}

export interface RunnerOptions {
  ids: Ids;
  now?: () => number;
}

export class Runner {
  readonly view = new Map<string, CampaignStatus>();
  private readonly backoff = new Map<string, { attempts: number; next: number; alerted: boolean }>();
  private readonly docs = new Map<string, SnapshotDocument>();
  private readonly now: () => number;

  constructor(
    private readonly chain: Chain,
    private readonly enclave: Enclave,
    private readonly blobs: BlobStore,
    private readonly alerts: Alerts,
    private readonly store: StateStore,
    private readonly opts: RunnerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** One pass: discover new campaigns, then move each active one forward. */
  async tick(): Promise<void> {
    const s = this.store.load();
    const found = await this.chain.newCampaigns(s.eventCursor);
    for (const id of found.ids) if (!s.campaigns.includes(id)) s.campaigns.push(id);
    s.eventCursor = found.cursor;
    this.store.save(s);
    for (const id of s.campaigns) {
      if (s.done.includes(id)) continue;
      await this.advance(id, s);
      this.store.save(s);
    }
  }

  private async advance(id: string, s: RunnerState) {
    const b = this.backoff.get(id);
    if (b && this.now() < b.next) return;
    for (let step = 0; step < STEPS_PER_TICK; step++) {
      let action: Action = { kind: "wait", reason: "" };
      try {
        const c = await this.chain.campaign(id);
        const refundable = c.status === Status.CANCELLED || c.status === Status.EXPIRED || c.status === Status.SETTLED;
        const objectsLeft = c.prizeKind === PRIZE_OBJECTS && refundable ? await this.chain.objectsLeft(id) : false;
        action = plan(c, this.now(), id in s.held, objectsLeft);
        this.record(id, c.status, action);
        if (action.kind === "wait") return;
        if (action.kind === "done") {
          s.done.push(id);
          delete s.held[id];
          this.docs.delete(id);
          return;
        }
        const digest = await this.act(action, c, s);
        this.backoff.delete(id);
        const v = this.view.get(id);
        if (v) Object.assign(v, { lastDigest: digest, lastError: undefined, attempts: 0 });
      } catch (e) {
        await this.fail(id, action, e);
        return;
      }
    }
  }

  private async act(action: Action, c: Campaign, s: RunnerState): Promise<string | undefined> {
    const ids = this.opts.ids;
    switch (action.kind) {
      case "snapshot":
        await this.snapshot(c, s);
        return undefined;
      case "commit":
        return this.commit(c, s);
      case "expire":
        return this.chain.execute(expireTx(ids, c));
      case "draw":
        return this.chain.execute(drawTx(ids, c));
      case "distribute":
        return this.chain.execute(distributeTx(ids, c, await this.document(c), action.ranks));
      case "reclaim":
        return this.chain.execute(reclaimTx(ids, c));
      case "refund_objects":
        return this.chain.execute(refundObjectsTx(ids, c));
      default:
        return undefined;
    }
  }

  /** Ask the enclave, check everything the Verify page checks, store on Walrus, hold for commit. */
  private async snapshot(c: Campaign, s: RunnerState) {
    const rulesText = dec.decode(await this.blobs.get(c.rulesBlob));
    const rules = parseCanonicalRules(rulesText);
    if (!rules.ok || toHex(rules.hash) !== c.rulesHash) throw new Permanent(`rules blob ${c.rulesBlob} does not hash to rules_hash`);

    const req: SnapshotRequest = {
      campaign_id: c.id,
      post_id: c.postId,
      opened_at: c.openedAt,
      closes_at: c.closesAt,
      mode: c.mode,
      k: c.k,
      max_entrants: c.maxEntrants,
      max_judged: c.maxJudged,
      max_replies_read: c.maxRepliesRead,
      rules_json: rulesText,
    };
    const r = await this.enclave.snapshot(req);
    await this.check(c, r);

    const blobId = await this.blobs.put(enc.encode(r.snapshot_json));
    const back = await this.blobs.get(blobId);
    if (toHex(blake2b256(back)) !== r.payload.snapshot_hash) throw new Error(`Walrus blob ${blobId} does not read back as uploaded`);
    s.held[c.id] = { response: r, blobId };
  }

  private async check(c: Campaign, r: SnapshotResponse) {
    const enclave = await this.chain.enclave(this.opts.ids.enclaveId);
    if (enclave.configVersion !== c.enclaveVersion) {
      throw new Permanent(`enclave config version ${enclave.configVersion} ≠ campaign's ${c.enclaveVersion}: commit would abort EWrongEnclave`);
    }
    if (r.public_key !== enclave.publicKey) throw new Permanent("snapshot signed by a key other than the registered enclave's");
    const failed = verifySnapshotResponse(r, enclave.publicKey).filter((x) => !x.pass);
    if (failed.length) throw new Permanent(`snapshot fails: ${failed.map((x) => x.name).join(", ")}`);
    const p = r.payload;
    const same =
      p.campaign_id === c.id &&
      p.post_id === c.postId &&
      p.rules_hash === c.rulesHash &&
      p.opened_at === String(c.openedAt) &&
      p.closes_at === String(c.closesAt) &&
      p.mode === c.mode &&
      p.k === c.k &&
      p.max_entrants === c.maxEntrants &&
      p.max_judged === c.maxJudged &&
      p.max_replies_read === c.maxRepliesRead;
    if (!same) throw new Permanent("snapshot payload does not match the campaign");
  }

  private async commit(c: Campaign, s: RunnerState): Promise<string> {
    const held = s.held[c.id]!;
    try {
      return await this.chain.execute(commitTx(this.opts.ids, c, held.response.payload, held.response.signature, held.blobId));
    } catch (e) {
      if (e instanceof TxFailed && e.abortCode !== undefined && (FATAL_COMMIT_ABORTS.has(e.abortCode) || e.abortCode === 4)) {
        delete s.held[c.id]; // can never land (or someone else committed)
      }
      throw e;
    } finally {
      if (!(c.id in s.held)) this.docs.delete(c.id);
    }
  }

  /** The committed snapshot document, from Walrus, checked against the on-chain hash. */
  private async document(c: Campaign): Promise<SnapshotDocument> {
    const cached = this.docs.get(c.id);
    if (cached) return cached;
    if (!c.snapshot) throw new Error("no committed snapshot");
    const data = await this.blobs.get(c.snapshot.blobId);
    if (toHex(blake2b256(data)) !== c.snapshot.snapshotHash) throw new Error("snapshot blob does not match snapshot_hash");
    const doc = JSON.parse(dec.decode(data)) as SnapshotDocument;
    this.docs.set(c.id, doc);
    return doc;
  }

  private record(id: string, status: number, action: Action) {
    const prev = this.view.get(id);
    const label = action.kind === "wait" ? `wait: ${action.reason}` : action.kind;
    this.view.set(id, { ...prev, attempts: prev?.attempts ?? 0, status, action: label, updatedAt: this.now() });
  }

  private async fail(id: string, action: Action, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const prev = this.backoff.get(id) ?? { attempts: 0, next: 0, alerted: false };
    const stale = e instanceof TxFailed && e.abortCode !== undefined && STALE_ABORTS.has(e.abortCode);
    const tooEarly = e instanceof EnclaveError && e.status === 409;
    const permanent = e instanceof Permanent || (e instanceof EnclaveError && (e.status === 400 || e.status === 401));
    const attempts = stale || tooEarly ? prev.attempts : prev.attempts + 1;
    const delay = tooEarly ? 60_000 : permanent ? BACKOFF_MAX_MS : Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
    let alerted = prev.alerted;
    if (!alerted && (permanent || attempts >= ALERT_AFTER)) {
      alerted = true;
      await this.alerts.send(`campaign ${id}: ${action.kind} failed ${attempts}× — ${msg}`);
    }
    this.backoff.set(id, { attempts, next: this.now() + (stale ? 0 : delay), alerted });
    const v = this.view.get(id);
    if (v) Object.assign(v, { lastError: msg, attempts });
  }
}
