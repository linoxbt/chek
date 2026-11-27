import { describe, expect, it } from "vitest";
import { Status } from "../src/campaign.ts";
import { EnclaveError, TxFailed } from "../src/ports.ts";
import { Runner } from "../src/runner.ts";
import { MemoryState } from "../src/state.ts";
import { campaign, CapturedAlerts, ENCLAVE, FakeChain, FakeEnclave, fixture, MemoryBlobs, PKG } from "./world.ts";

const CLOSE = fixture.request.closes_at;

function world(over = {}, now = CLOSE + 60_000) {
  const chain = new FakeChain(campaign(over));
  const enclave = new FakeEnclave();
  const blobs = new MemoryBlobs();
  const alerts = new CapturedAlerts();
  const store = new MemoryState();
  let t = now;
  const runner = new Runner(chain, enclave, blobs, alerts, store, { ids: { packageId: PKG, enclaveId: ENCLAVE }, now: () => t });
  return { chain, enclave, blobs, alerts, store, runner, advance: (ms: number) => (t += ms) };
}

const fns = (chain: FakeChain) => chain.executed.map((cs) => cs.map((c) => c.target.split("::").pop()).join("+"));

describe("runner", () => {
  it("takes a closed giveaway from snapshot to paid in one tick", async () => {
    const w = world();
    await w.runner.tick();
    expect(w.enclave.requests).toHaveLength(1);
    expect(w.enclave.requests[0]).toEqual(fixture.request);
    expect(fns(w.chain)).toEqual(["new+commit_snapshot", "draw", "distribute_coin+distribute_coin"]);
    expect(w.chain.c.status).toBe(Status.SETTLED);
    expect(w.blobs.blobs.get("snap-blob-1")).toEqual(new TextEncoder().encode(fixture.response.snapshot_json));
    // Settled: nothing more to do, and the campaign is retired on the next tick.
    await w.runner.tick();
    expect(w.store.state.done).toContain(w.chain.c.id);
    expect(w.store.state.held).toEqual({});
  });

  it("reclaims a coin remainder when the pool doesn't split evenly", async () => {
    const w = world({ pool: 301n });
    await w.runner.tick();
    expect(fns(w.chain).at(-1)).toBe("reclaim_unused");
    expect(w.chain.c.status).toBe(Status.SETTLED);
  });

  it("does nothing before close + 30 s and expires after close + 48 h", async () => {
    const early = world({}, CLOSE + 29_000);
    await early.runner.tick();
    expect(early.enclave.requests).toHaveLength(0);

    const late = world({}, CLOSE + 48 * 3600_000 + 1);
    await late.runner.tick();
    expect(fns(late.chain)).toEqual(["expire"]);
    expect(late.enclave.requests).toHaveLength(0);
  });

  it("waits for expiry, without asking the enclave, once the 6-hour fetch window has passed", async () => {
    const w = world({}, CLOSE + 7 * 3600_000);
    await w.runner.tick();
    expect(w.enclave.requests).toHaveLength(0);
    expect(w.runner.view.get(w.chain.c.id)?.action).toMatch(/expires after 48 h/);
  });

  it("refuses a snapshot signed by another key, and alerts", async () => {
    const w = world();
    w.chain.enclaveKey = "11".repeat(32);
    await w.runner.tick();
    expect(w.chain.executed).toHaveLength(0);
    expect(w.alerts.messages[0]).toMatch(/other than the registered enclave/);
  });

  it("refuses a tampered snapshot or one for other settings", async () => {
    const tampered = world();
    tampered.enclave.respond = () => {
      const r = structuredClone(fixture.response);
      r.snapshot_json = r.snapshot_json.replace("user21", "user99");
      return r;
    };
    await tampered.runner.tick();
    expect(tampered.chain.executed).toHaveLength(0);
    expect(tampered.alerts.messages[0]).toMatch(/snapshot_hash/);

    const otherK = world({ k: 2 });
    await otherK.runner.tick();
    expect(otherK.chain.executed).toHaveLength(0);
    expect(otherK.alerts.messages[0]).toMatch(/does not match the campaign/);
  });

  it("warns before committing a snapshot from an enclave the campaign doesn't accept", async () => {
    const w = world({ enclaveVersion: 1 });
    await w.runner.tick();
    expect(w.chain.executed).toHaveLength(0);
    expect(w.alerts.messages[0]).toMatch(/EWrongEnclave/);
  });

  it("checks the rules blob before spending an enclave call", async () => {
    const w = world({ rulesHash: "00".repeat(32) });
    await w.runner.tick();
    expect(w.enclave.requests).toHaveLength(0);
    expect(w.alerts.messages[0]).toMatch(/does not hash to rules_hash/);
  });

  it("never commits a blob that doesn't read back as uploaded", async () => {
    const w = world();
    w.blobs.corruptReads = true;
    await w.runner.tick();
    expect(w.chain.executed).toHaveLength(0);
    expect(w.runner.view.get(w.chain.c.id)?.lastError).toMatch(/read back/);
  });

  it("backs off on enclave outages and alerts after 6 failures", async () => {
    const w = world();
    w.enclave.error = new EnclaveError(502, "X down");
    for (let i = 0; i < 6; i++) {
      if (i > 0) w.advance(10 * 60 * 1000);
      await w.runner.tick();
    }
    expect(w.enclave.requests).toHaveLength(6);
    expect(w.alerts.messages).toHaveLength(1);
    expect(w.alerts.messages[0]).toMatch(/failed 6×/);
    // Within the backoff delay nothing is retried.
    const before = w.enclave.requests.length;
    await w.runner.tick();
    expect(w.enclave.requests.length).toBe(before);
    // Recovery: the next attempt after the delay succeeds and the giveaway completes.
    w.enclave.error = null;
    w.advance(10 * 60 * 1000);
    await w.runner.tick();
    expect(w.chain.c.status).toBe(Status.SETTLED);
  });

  it("keeps a held snapshot through a transient commit failure, drops it on a fatal abort", async () => {
    const w = world();
    w.chain.failNext = new TxFailed("RPC timeout");
    await w.runner.tick();
    expect(Object.keys(w.store.state.held)).toEqual([w.chain.c.id]);
    expect(w.enclave.requests).toHaveLength(1);
    w.advance(2000);
    await w.runner.tick();
    expect(w.enclave.requests).toHaveLength(1); // committed from the held snapshot, no second X bill
    expect(w.chain.c.status).toBe(Status.SETTLED);

    const fatal = world();
    fatal.chain.failNext = new TxFailed("MoveAbort EWindow", 11);
    await fatal.runner.tick();
    expect(fatal.store.state.held).toEqual({});
  });

  it("treats a payout someone else already made as stale, not as a failure", async () => {
    const w = world();
    await w.runner.tick(); // settles
    const v = w.runner.view.get(w.chain.c.id)!;
    expect(v.attempts).toBe(0);
    const s = world({ status: Status.COMMITTED, snapshot: { enclaveId: ENCLAVE, fetchedAt: 0, n: 2, repliesSeen: 5,
      root: fixture.response.payload.root, snapshotHash: fixture.response.payload.snapshot_hash, blobId: "snap-blob-1", linked: true } });
    s.blobs.blobs.set("snap-blob-1", new TextEncoder().encode(fixture.response.snapshot_json));
    s.chain.failNext = new TxFailed("EWrongState", 4); // another runner drew first
    await s.runner.tick();
    expect(s.alerts.messages).toHaveLength(0);
    expect(s.runner.view.get(s.chain.c.id)!.attempts).toBe(0);
  });
});
