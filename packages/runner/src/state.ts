import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SnapshotResponse } from "@chek/core";

/**
 * The runner's local cache. Nothing here is a record: chain plus Walrus can rebuild every
 * giveaway. Losing it costs at most a repeated snapshot request (cached by the enclave for 1 h)
 * and a rescan of Created events.
 */
export interface RunnerState {
  eventCursor: string | null;
  campaigns: string[];
  done: string[];
  /** Signed snapshots already uploaded to Walrus, waiting to be committed. */
  held: Record<string, { response: SnapshotResponse; blobId: string }>;
}

export const emptyState = (): RunnerState => ({ eventCursor: null, campaigns: [], done: [], held: {} });

export interface StateStore {
  load(): RunnerState;
  save(s: RunnerState): void;
}

export class FileState implements StateStore {
  constructor(private readonly path: string) {}

  load(): RunnerState {
    try {
      return { ...emptyState(), ...(JSON.parse(readFileSync(this.path, "utf8")) as Partial<RunnerState>) };
    } catch {
      return emptyState();
    }
  }

  save(s: RunnerState) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, this.path);
  }
}

export class MemoryState implements StateStore {
  constructor(public state: RunnerState = emptyState()) {}
  load() {
    return structuredClone(this.state);
  }
  save(s: RunnerState) {
    this.state = structuredClone(s);
  }
}
