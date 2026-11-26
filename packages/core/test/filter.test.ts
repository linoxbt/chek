import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRules, type RulesV1 } from "../src/index.ts";
import { MissingVerdict, runFilter, type FilterContext, type Reply, type Verdict } from "./port/filter.ts";

interface Case {
  name: string; context: FilterContext; rules: RulesV1; names: Record<string, string | null>;
  verdicts: Record<string, Verdict>; replies: Reply[]; expected: Record<string, unknown>;
}
const load = (f: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures", f), "utf8"));

function run(c: Case) {
  const v = validateRules(c.rules);
  if (!v.ok) throw new Error(`${c.name}: ${v.errors.join("; ")}`);
  return runFilter(c.context, v.rules, c.replies, c.names, c.verdicts);
}

describe("rules filter port: hand-written cases (fixtures/filter-cases.json)", () => {
  const { cases } = load("filter-cases.json") as { cases: Case[] };
  it.each(cases)("$name", (c) => {
    if ("error" in c.expected) {
      expect(() => run(c)).toThrow(MissingVerdict);
      expect(() => run(c)).toThrow(String(c.expected.error));
    } else {
      expect(run(c)).toEqual(c.expected);
    }
  });
});

describe("rules filter port: generated cross-check (fixtures/filter-random.json, outcomes from Rust)", () => {
  const { cases } = load("filter-random.json") as { cases: Case[] };
  it.each(cases)("$name", (c) => {
    expect(run(c)).toEqual(c.expected);
  });
});
