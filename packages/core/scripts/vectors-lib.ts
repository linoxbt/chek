import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const VECTORS_PATH = resolve(REPO_ROOT, "fixtures/vectors.json");

/** Writes `content` to `path`, or with --check fails if the file differs. */
export function writeOrCheck(path: string, content: string): void {
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // missing file counts as different
    }
    if (current !== content) {
      console.error(`${path} is out of date; run pnpm vectors`);
      process.exit(1);
    }
    console.log(`${path} is up to date`);
    return;
  }
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
}
