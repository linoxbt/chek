import { describe, expect, it } from "vitest";
import { MOVE_ERRORS, moveErrorMessage } from "../src/index.ts";

describe("Move error map", () => {
  it("covers every chek::campaign abort code, 1 to 16", () => {
    expect(Object.keys(MOVE_ERRORS).map(Number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
  it("falls back to the code for anything unknown", () => {
    expect(moveErrorMessage(4)).toMatch(/current stage/);
    expect(moveErrorMessage(77)).toMatch(/code 77/);
  });
});
