/**
 * The Verify page's checks (FR16, AC19). Everything is recomputed in the browser from the chain
 * and Walrus only: no Chek server is asked anything (NFR8).
 */
import {
  blake2b256,
  canonicalize,
  fromHex,
  MerkleTree,
  Mode,
  parseCanonicalRules,
  Status,
  toHex,
  verifyProof,
  type Campaign,
  type Leaf,
  type ReasonCode,
  type RulesV1,
  type SnapshotDocument,
  type SnapshotEntrant,
} from "@chek/core";
import type { EnclaveConfigInfo, History, Reader } from "./reader.ts";

export type CheckState = "pass" | "fail" | "pending";
export interface VerifyCheck {
  id: string;
  title: string;
  state: CheckState;
  /** One plain sentence on what was checked or what went wrong. */
  detail: string;
}

export interface Winner {
  rank: number;
  index: number;
  entrant: SnapshotEntrant | undefined;
  proofOk: boolean;
  payout: History["payouts"][number] | undefined;
}

export interface VerifyReport {
  campaign: Campaign;
  rules: RulesV1 | null;
  doc: SnapshotDocument | null;
  enclave: { id: string; publicKey: string; configVersion: number; config: EnclaveConfigInfo } | null;
  history: History;
  winners: Winner[];
  checks: VerifyCheck[];
  /** Overall: every check that can run has passed. */
  ok: boolean;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export const REASON_TEXT: Record<ReasonCode, string> = {
  NO_ADDRESS: "The reply had no Sui address or SuiNS name.",
  DUP_ACCOUNT: "This X account had already entered; only its first reply counts.",
  DUP_ADDRESS: "This address was already used by an earlier reply.",
  TOO_YOUNG: "The X account was newer than the rules allow.",
  FEW_FOLLOWERS: "The X account had fewer followers than the rules require.",
  MISSING_TEXT: "The reply was missing text the rules require.",
  NO_MEDIA: "The rules require an image or video and the reply had none.",
  EXCLUDED: "The organizer excluded this account in the rules.",
  LATE: "The reply was posted after the giveaway closed.",
  SUINS_UNRESOLVED: "The SuiNS name did not resolve to an address.",
  AI_FAIL: "The AI judge marked the reply as not meeting the rubric.",
  OVER_CAP: "The giveaway's entrant limit was already reached.",
  NOT_DIRECT: "The reply was not a direct reply to the giveaway post.",
};

export const STATUS_TEXT: Record<number, string> = {
  [Status.DRAFT]: "Draft",
  [Status.OPEN]: "Open",
  [Status.COMMITTED]: "Snapshot taken",
  [Status.DRAWN]: "Winners drawn",
  [Status.SETTLED]: "Paid out",
  [Status.EXPIRED]: "Expired, refunded",
  [Status.CANCELLED]: "Cancelled",
};

function check(checks: VerifyCheck[], id: string, title: string, pass: boolean | null, ok: string, bad: string) {
  checks.push({ id, title, state: pass === null ? "pending" : pass ? "pass" : "fail", detail: pass === false ? bad : ok });
}

async function text(reader: Reader, id: string): Promise<string | null> {
  try {
    return dec.decode(await reader.blob(id));
  } catch {
    return null;
  }
}

export async function verifyCampaign(reader: Reader, id: string): Promise<VerifyReport> {
  const c = await reader.campaign(id);
  const checks: VerifyCheck[] = [];
  const history = c.snapshot ? await reader.history(id) : { committedDigest: undefined, drawnDigest: undefined, payouts: [] };

  // 1. Rules: the Walrus document is canonical and hashes to the rules_hash fixed at creation.
  const rulesText = await text(reader, c.rulesBlob);
  const parsed = rulesText === null ? null : parseCanonicalRules(rulesText);
  const rules = parsed?.ok ? parsed.rules : null;
  check(
    checks,
    "rules",
    "Rules unchanged since creation",
    parsed === null ? false : parsed.ok && toHex(parsed.hash) === c.rulesHash,
    "The rules on Walrus hash to the rules_hash locked into the giveaway when it was created.",
    parsed === null ? "The rules document could not be fetched from Walrus." : "The rules on Walrus do not match the hash locked in at creation.",
  );
  if (rules) {
    check(checks, "mode", "Mode matches the rules", (rules.mode === "judged") === (c.mode === Mode.JUDGED), `This is a ${c.mode === Mode.JUDGED ? "Judged Draw" : "Random Draw"}, as the rules say.`, "The on-chain mode differs from the rules.");
  }

  if (!c.snapshot) {
    const why = c.status === Status.EXPIRED ? "No snapshot was committed in time, so the prize went back to the organizer." : c.status === Status.CANCELLED ? "The organizer cancelled before opening." : "The snapshot is taken after the giveaway closes.";
    checks.push({ id: "snapshot", title: "Snapshot", state: "pending", detail: why });
    return { campaign: c, rules, doc: null, enclave: null, history, winners: [], checks, ok: checks.every((x) => x.state !== "fail") };
  }
  const s = c.snapshot;

  // 2. Enclave: the snapshot came from an enclave registered under the PCRs pinned at creation.
  let enclave: VerifyReport["enclave"] = null;
  try {
    const [e, config] = await Promise.all([reader.enclave(s.enclaveId), reader.enclaveConfig()]);
    enclave = { id: s.enclaveId, ...e, config };
  } catch {
    enclave = null;
  }
  check(
    checks,
    "enclave",
    "Snapshot taken by the pinned enclave",
    enclave ? enclave.configVersion === c.enclaveVersion : false,
    `The enclave was registered from an attestation of the enclave image version ${c.enclaveVersion}, the version this giveaway pinned at creation.`,
    enclave ? `The enclave is on version ${enclave.configVersion}, but this giveaway pinned ${c.enclaveVersion}.` : "The enclave object could not be read.",
  );
  check(
    checks,
    "signature",
    "Enclave signature",
    history.committedDigest ? true : null,
    history.committedDigest
      ? `commit_snapshot checked the enclave's Ed25519 signature on-chain in transaction ${history.committedDigest}; the transaction would have failed otherwise.`
      : "Waiting for the commit transaction to be indexed.",
    "",
  );

  // 3. Snapshot document: on Walrus, hash-pinned, canonical, consistent with the committed fields.
  const docText = await text(reader, s.blobId);
  let doc: SnapshotDocument | null = null;
  try {
    doc = docText === null ? null : (JSON.parse(docText) as SnapshotDocument);
  } catch {
    doc = null;
  }
  check(
    checks,
    "doc-hash",
    "Snapshot file unchanged",
    docText !== null && toHex(blake2b256(enc.encode(docText))) === s.snapshotHash,
    "The snapshot file on Walrus hashes to the snapshot_hash the enclave signed.",
    docText === null ? "The snapshot file could not be fetched from Walrus." : "The snapshot file on Walrus does not match the signed hash.",
  );
  check(checks, "doc-canonical", "Snapshot file is canonical", doc !== null && canonicalize(doc) === docText, "The file is in the one canonical form, so its hash is unambiguous.", "The file is not canonical JSON.");
  if (doc) {
    const fieldsOk =
      doc.v === 1 &&
      doc.campaign_id === c.id &&
      doc.post_id === c.postId &&
      doc.post_author_id === s.postAuthorId &&
      doc.linked === s.linked &&
      doc.fetched_at === s.fetchedAt &&
      doc.rules_hash === c.rulesHash &&
      doc.replies_seen === s.repliesSeen &&
      doc.entrants.length === s.n &&
      doc.entrants.every((e, k) => e.i === k);
    check(checks, "doc-fields", "Snapshot matches the chain", fieldsOk, `It is for this giveaway and post, lists ${s.n} entrants out of ${s.repliesSeen} replies, and used these rules.`, "Fields in the file differ from what was committed on-chain.");
    let rootOk = false;
    let tree: MerkleTree | null = null;
    try {
      tree = new MerkleTree(doc.entrants.map((e): Leaf => ({ i: e.i, author_id: e.author_id, address: e.address })));
      rootOk = toHex(tree.root) === s.root;
    } catch {
      rootOk = false;
    }
    check(checks, "root", "Entrant list matches the Merkle root", rootOk, "Rebuilding the Merkle tree from the entrants gives the root the draw used.", "The entrant list does not give the committed Merkle root.");
    check(
      checks,
      "linked",
      "Post links to this giveaway",
      s.linked,
      "The post contains this giveaway's Chek link, so this giveaway is the one the post announced.",
      "The post does not contain this giveaway's link. The draw is still fair, but nothing ties the post to this giveaway.",
    );
    if (doc.ai) {
      check(
        checks,
        "rubric",
        "AI rubric unchanged",
        rules?.rubric ? toHex(blake2b256(enc.encode(rules.rubric.prompt))) === doc.ai.rubric_hash && rules.rubric.model === doc.ai.model : false,
        `${doc.ai.judged} replies were judged pass/fail by ${doc.ai.model} against the rubric in the rules.`,
        "The rubric the judge used does not match the rules.",
      );
    }

    // 4. Winners: each one is in the committed list (Merkle proof against the root), ranks paid.
    if (c.winners.length > 0 || c.status >= Status.DRAWN) {
      const winners: Winner[] = c.winners.map((index, rank) => {
        const entrant = doc!.entrants[index];
        let proofOk = false;
        if (tree && entrant) {
          try {
            proofOk = verifyProof(fromHex(s.root), { i: index, author_id: entrant.author_id, address: entrant.address }, tree.proof(index));
          } catch {
            proofOk = false;
          }
        }
        return { rank: rank + 1, index, entrant, proofOk, payout: history.payouts.find((p) => p.rank === rank) };
      });
      const expected = Math.min(c.k, s.n);
      check(
        checks,
        "draw",
        "Winners drawn with Sui Random",
        winners.length === expected && new Set(c.winners).size === winners.length && winners.every((w) => w.proofOk),
        history.drawnDigest
          ? `${winners.length} distinct winners were drawn on-chain by Sui's randomness in transaction ${history.drawnDigest}; each has a valid Merkle proof.`
          : `${winners.length} distinct winners; each has a valid Merkle proof.`,
        `Expected ${expected} distinct winners with valid Merkle proofs.`,
      );
      const coin = c.prizeKind === 0;
      const paidOk = winners.every((w) => !c.paid[w.rank - 1] || (w.payout && w.entrant && w.payout.to === w.entrant.address && (!coin || BigInt(w.payout.amount) === c.perWinner)));
      const allPaid = winners.length > 0 && winners.every((w) => c.paid[w.rank - 1]);
      check(
        checks,
        "payouts",
        "Prizes paid to the winners' addresses",
        allPaid ? paidOk : paidOk ? null : false,
        allPaid ? "Every prize went to the address in the winning reply." : "Payouts are in progress; those made so far went to the right addresses.",
        "A payout went to an address other than the winner's.",
      );
      return finish({ campaign: c, rules, doc, enclave, history, winners, checks });
    }
  }
  return finish({ campaign: c, rules, doc, enclave, history, winners: [], checks });
}

function finish(r: Omit<VerifyReport, "ok">): VerifyReport {
  return { ...r, ok: r.checks.every((x) => x.state !== "fail") };
}

export type EntrantLookup =
  | { kind: "entrant"; entrant: SnapshotEntrant; winnerRank: number | null }
  | { kind: "excluded"; replyId: string; code: string; text: string }
  | { kind: "none" };

/** Find an entry by @handle, Sui address, reply link or reply ID ("Was I counted?"). */
export function lookupEntrant(doc: SnapshotDocument, winners: number[], query: string): EntrantLookup {
  const q = query.trim();
  if (!q) return { kind: "none" };
  const replyId = /status\/(\d+)/.exec(q)?.[1] ?? (/^\d+$/.test(q) ? q : null);
  const handle = q.replace(/^@/, "").toLowerCase();
  const addr = /^0x[0-9a-fA-F]{1,64}$/.test(q) ? `0x${q.slice(2).toLowerCase().padStart(64, "0")}` : null;
  const e = doc.entrants.find((x) => (replyId && x.reply_id === replyId) || (addr && x.address === addr) || x.handle.toLowerCase() === handle);
  if (e) {
    const rank = winners.indexOf(e.i);
    return { kind: "entrant", entrant: e, winnerRank: rank < 0 ? null : rank + 1 };
  }
  if (replyId) {
    const x = doc.excluded.find((y) => y.reply_id === replyId);
    if (x) return { kind: "excluded", replyId, code: x.code, text: x.reason ?? REASON_TEXT[x.code as ReasonCode] ?? x.code };
  }
  return { kind: "none" };
}
