/** Move abort codes of chek::campaign (spec section 13), with the plain message screens show. */
export const MOVE_ERRORS = {
  1: { name: "EPaused", message: "Chek is not accepting new giveaways right now." },
  2: { name: "EBadParam", message: "Winners, close time or prize kind is out of range." },
  3: { name: "EWrongFee", message: "The creation fee doesn't match the current fee." },
  4: { name: "EWrongState", message: "This step isn't allowed at the giveaway's current stage." },
  5: { name: "ENotOrganizer", message: "This organizer key belongs to a different giveaway." },
  6: { name: "EWrongPrize", message: "The prize doesn't match this giveaway (kind, type or count)." },
  7: { name: "ENotFunded", message: "Fund the full prize (a multiple of the winner count) before opening." },
  8: { name: "EClosed", message: "The close time has already passed." },
  9: { name: "EBadSig", message: "The snapshot isn't signed by a registered Chek enclave." },
  10: { name: "EMismatch", message: "The snapshot was made for different giveaway settings." },
  11: { name: "EWindow", message: "The snapshot was fetched or committed outside its time window." },
  12: { name: "ETooEarly", message: "The giveaway can't be expired until 48 hours after close." },
  13: { name: "EBadProof", message: "That entrant is not the winner for this rank." },
  14: { name: "EPaid", message: "This prize has already been paid." },
  15: { name: "ENothingUnused", message: "There is no unused prize to reclaim." },
  16: { name: "EWrongEnclave", message: "The snapshot was signed by an enclave build registered after this giveaway was created." },
} as const satisfies Record<number, { name: string; message: string }>;

export type MoveErrorCode = keyof typeof MOVE_ERRORS;

export function moveErrorMessage(code: number): string {
  const e = (MOVE_ERRORS as Record<number, { name: string; message: string }>)[code];
  return e ? e.message : `The transaction was rejected (code ${code}).`;
}
