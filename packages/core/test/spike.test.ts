import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { goNoGo, spikeSigningBytes, toHex, verifySpikeResponse, type SpikeResponse } from "../src/index.ts";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/spike-response.json"), "utf8")) as {
  public_key: string;
  response: SpikeResponse;
  signing_bytes: string;
};

describe("enclave spike response (fixture written by the Rust enclave)", () => {
  it("re-encodes to the exact bytes the enclave signed", () => {
    expect(toHex(spikeSigningBytes(fixture.response))).toBe(fixture.signing_bytes);
  });
  it("verifies against the enclave key and keeps 64-bit IDs exact", () => {
    expect(verifySpikeResponse(fixture.public_key, fixture.response)).toBe(true);
    expect(fixture.response.response.data.post_author_id).toBe("18446744073709551615");
  });
  it("rejects a changed field, another key or another intent", () => {
    const r = structuredClone(fixture.response);
    r.response.data.x_search_status = 403;
    expect(verifySpikeResponse(fixture.public_key, r)).toBe(false);
    expect(verifySpikeResponse("00".repeat(32), fixture.response)).toBe(false);
    const other = structuredClone(fixture.response);
    other.response.intent = 1;
    expect(verifySpikeResponse(fixture.public_key, other)).toBe(false);
  });
  it("go/no-go passes the fixture and treats a failed A10 alone as go", () => {
    expect(goNoGo(fixture.public_key, fixture.response).go).toBe(true);
    // A signed report with A10 failed: still go (fallback is recent search, 7-day giveaways).
    const a10 = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/spike-response.json"), "utf8")).response as SpikeResponse;
    a10.response.data.x_search_status = 403;
    const checks = goNoGo(fixture.public_key, a10).checks;
    expect(checks.find((c) => c.name.startsWith("A10"))!.pass).toBe(false);
    expect(checks.filter((c) => !c.name.startsWith("A10") && !c.name.startsWith("signature")).every((c) => c.pass)).toBe(true);
    const r = structuredClone(fixture.response);
    r.response.data.anthropic_status = 0;
    expect(goNoGo(fixture.public_key, r).go).toBe(false);
  });
});
