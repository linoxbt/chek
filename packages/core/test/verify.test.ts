import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRules, verifySnapshotResponse, type SnapshotResponse } from "../src/index.ts";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/snapshot-e2e.json"), "utf8")) as {
  request: { rules_json: string };
  response: SnapshotResponse;
};
const failing = (r: SnapshotResponse, pk?: string) => verifySnapshotResponse(r, pk).filter((c) => !c.pass).map((c) => c.name);

describe("snapshot from the Rust enclave pipeline (fixtures/snapshot-e2e.json)", () => {
  it("passes every Verify-page check", () => {
    expect(failing(fixture.response)).toEqual([]);
    expect(verifyRules(fixture.request.rules_json, fixture.response.payload).pass).toBe(true);
  });

  it("records a Judged Draw with two entrants and the cost counters", () => {
    const doc = JSON.parse(fixture.response.snapshot_json);
    expect(doc.ai.model).toBe("claude-opus-5-5");
    expect(doc.entrants).toHaveLength(2);
    expect(fixture.response.llm_calls).toBe(3);
  });

  it("catches a changed document, payload field, root, key or rules", () => {
    const r = structuredClone(fixture.response);
    r.snapshot_json = r.snapshot_json.replace('"handle":"user21"', '"handle":"user99"');
    expect(failing(r)).toContain("snapshot_hash is Blake2b-256 of the document");

    const p = structuredClone(fixture.response);
    p.payload.n = p.payload.n + 1;
    expect(failing(p)).toEqual(expect.arrayContaining(["signature by the enclave key", "document matches the signed payload"]));

    const doc = JSON.parse(fixture.response.snapshot_json);
    doc.entrants.reverse();
    const reordered = structuredClone(fixture.response);
    reordered.snapshot_json = JSON.stringify(doc);
    expect(failing(reordered)).toEqual(expect.arrayContaining(["entrants are indexed 0..n−1"]));

    expect(failing(fixture.response, "00".repeat(32))).toEqual(["signature by the enclave key"]);
    expect(verifyRules(fixture.request.rules_json.replace('"min_followers":10', '"min_followers":11'), fixture.response.payload).pass).toBe(false);
  });
});
