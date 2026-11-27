/** X post URLs and IDs. Post IDs are snowflakes: (id >> 22) + this epoch = creation time in ms. */
export const X_EPOCH_MS = 1_288_834_974_657n;

/** `https://x.com/<user>/status/<id>` (or twitter.com, mobile., with query) → the post ID. */
export function parsePostUrl(input: string): string | null {
  const s = input.trim();
  if (/^\d{1,20}$/.test(s)) return s;
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,20})(?:[/?#].*)?$/.exec(s);
  return m ? m[1]! : null;
}

export function postTimeMs(postId: string): number {
  return Number((BigInt(postId) >> 22n) + X_EPOCH_MS);
}

/** The link the organizer puts in the post (MD9); the enclave checks for exactly this. */
export function giveawayLink(origin: string, campaignId: string): string {
  return `${origin.replace(/\/$/, "")}/g/${campaignId.toLowerCase()}`;
}
