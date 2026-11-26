/** Values fixed by the Chek build spec (sections 8, 10 and 13). Shared by web, runner and tests. */

export const Mode = { DRAW: 0, JUDGED: 1 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const Status = {
  DRAFT: 0,
  OPEN: 1,
  COMMITTED: 2,
  DRAWN: 3,
  SETTLED: 4,
  EXPIRED: 5,
  CANCELLED: 6,
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export const PrizeKind = { COIN: 0, OBJECTS: 1 } as const;
export type PrizeKind = (typeof PrizeKind)[keyof typeof PrizeKind];

/** Reason codes written to `excluded[].code` in the snapshot document. */
export const REASON_CODES = [
  "NO_ADDRESS",
  "DUP_ACCOUNT",
  "DUP_ADDRESS",
  "TOO_YOUNG",
  "FEW_FOLLOWERS",
  "MISSING_TEXT",
  "NO_MEDIA",
  "EXCLUDED",
  "LATE",
  "SUINS_UNRESOLVED",
  "AI_FAIL",
  "OVER_CAP",
  "NOT_DIRECT",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const LIMITS = {
  K_MIN: 1,
  K_MAX: 100,
  /** closes_at must be at least this far after creation. */
  CLOSE_MIN_MS: 10 * 60 * 1000,
  /** closes_at must be at most this far after creation. */
  CLOSE_MAX_MS: 30 * 24 * 60 * 60 * 1000,
  MAX_ENTRANTS_CEILING: 5_000,
  MAX_JUDGED_CEILING: 1_000,
  /** The enclave may fetch only within this window after closes_at (MD12). */
  FETCH_WINDOW_MS: 6 * 60 * 60 * 1000,
  /** A snapshot must be committed within this window after closes_at, else anyone can expire (MD12). */
  COMMIT_WINDOW_MS: 48 * 60 * 60 * 1000,
  /** Merkle depth for MAX_ENTRANTS_CEILING leaves (2^13 = 8192). */
  MAX_MERKLE_DEPTH: 13,
} as const;

/** Intent scope used for every enclave-signed message (Nautilus IntentMessage.intent). */
export const SNAPSHOT_INTENT = 1;
