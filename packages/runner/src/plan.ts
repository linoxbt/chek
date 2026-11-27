import { PRIZE_OBJECTS, Status, type Campaign } from "@chek/core";

/** Timing rules from the spec (MD12) and the enclave (30 s settle). */
export const SETTLE_MS = 30_000;
export const FETCH_WINDOW_MS = 6 * 60 * 60 * 1000;
export const COMMIT_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Ranks paid per transaction, and object prizes moved per refund call. */
export const BATCH = 50;

export type Action =
  | { kind: "wait"; reason: string; until?: number }
  | { kind: "done" }
  | { kind: "snapshot" }
  | { kind: "commit" }
  | { kind: "expire" }
  | { kind: "draw" }
  | { kind: "distribute"; ranks: number[] }
  | { kind: "reclaim" }
  | { kind: "refund_objects" };

/**
 * The next step for one campaign, from its on-chain state alone (plus whether this runner holds
 * a signed snapshot for it, and whether object prizes are still in it). Every step is one that
 * anyone may take; repeating a stale one aborts harmlessly on-chain.
 */
export function plan(c: Campaign, now: number, holdsSnapshot: boolean, objectsLeft: boolean): Action {
  switch (c.status) {
    case Status.DRAFT:
      return { kind: "wait", reason: "draft: the organizer has not opened it" };
    case Status.OPEN: {
      if (now > c.closesAt + COMMIT_WINDOW_MS) return { kind: "expire" };
      if (holdsSnapshot) return { kind: "commit" };
      if (now < c.closesAt + SETTLE_MS) return { kind: "wait", reason: "entries open", until: c.closesAt + SETTLE_MS };
      if (now <= c.closesAt + FETCH_WINDOW_MS) return { kind: "snapshot" };
      return { kind: "wait", reason: "fetch window passed: expires after 48 h", until: c.closesAt + COMMIT_WINDOW_MS + 1 };
    }
    case Status.COMMITTED:
      return { kind: "draw" };
    case Status.DRAWN: {
      const ranks = c.paid.flatMap((p, r) => (p ? [] : [r])).slice(0, BATCH);
      if (ranks.length > 0) return { kind: "distribute", ranks };
      if (c.unusedPending) return { kind: "reclaim" };
      return { kind: "wait", reason: "drawn and paid; settling" };
    }
    case Status.SETTLED:
    case Status.EXPIRED:
    case Status.CANCELLED: {
      const refundable = c.status !== Status.SETTLED || c.snapshot?.n === 0;
      if (c.prizeKind === PRIZE_OBJECTS && refundable && objectsLeft) return { kind: "refund_objects" };
      return { kind: "done" };
    }
    default:
      return { kind: "wait", reason: `unknown status ${c.status}` };
  }
}
