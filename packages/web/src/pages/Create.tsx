import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { LIMITS } from "@chek/core";
import { config } from "../lib/config.ts";
import { buildRules, DEFAULT_FORM, estimateXCostUsd, type RulesForm } from "../lib/rules-form.ts";
import { createCoinGiveawayTx, createObjectGiveawayTx } from "../lib/organizer.ts";
import { putBlob } from "../lib/walrus.ts";
import { chainIds, createdCampaignId, fmtSui, parseSui, reader } from "../lib/app.ts";
import { ErrorBox, Field } from "../components/bits.tsx";

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function Create() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const navigate = useNavigate();
  const fee = useQuery({ queryKey: ["fee"], queryFn: () => reader.feeMist() });
  const [form, setForm] = useState<RulesForm>(DEFAULT_FORM);
  const [k, setK] = useState(3);
  const [prizeKind, setPrizeKind] = useState<"coin" | "objects">("coin");
  const [amount, setAmount] = useState("10");
  const [objectType, setObjectType] = useState("");
  const [objectIds, setObjectIds] = useState("");
  const [closes, setCloses] = useState(() => toLocalInput(Date.now() + 24 * 3600_000));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof RulesForm>(key: K, v: RulesForm[K]) => setForm((f) => ({ ...f, [key]: v }));

  const built = buildRules(form);
  const closesAt = new Date(closes).getTime();
  const mist = parseSui(amount);
  const ids = objectIds.split(/\s+/).filter(Boolean);
  const problems: string[] = [];
  if (!built.ok) problems.push(...built.errors);
  if (!(k >= LIMITS.K_MIN && k <= LIMITS.K_MAX && Number.isInteger(k))) problems.push(`Winners must be a whole number from ${LIMITS.K_MIN} to ${LIMITS.K_MAX}.`);
  const now = Date.now();
  if (!(closesAt >= now + LIMITS.CLOSE_MIN_MS + 5 * 60_000)) problems.push("Close time must be at least 15 minutes from now.");
  if (!(closesAt <= now + LIMITS.CLOSE_MAX_MS - 5 * 60_000)) problems.push("Close time must be within 30 days.");
  if (prizeKind === "coin" && (mist === null || mist < BigInt(k))) problems.push("Enter the SUI prize amount (it is split evenly between the winners).");
  if (prizeKind === "objects" && ids.length !== k) problems.push(`List exactly ${k} object IDs, one per winner, in rank order.`);
  if (prizeKind === "objects" && !/^0x[0-9a-fA-F]+::\w+::\w+/.test(objectType)) problems.push("Enter the object type, like 0x…::module::Name.");

  async function submit() {
    setError(null);
    if (!account || !built.ok || problems.length) return;
    try {
      setBusy("Uploading the rules to Walrus…");
      const rulesBlob = await putBlob(new TextEncoder().encode(built.text));
      const p = { mode: form.mode === "judged" ? 1 : 0, k, closesAt, rulesBlob, rulesHash: built.hash, feeMist: fee.data ?? 0n, sender: account.address } as const;
      const tx = prizeKind === "coin" ? createCoinGiveawayTx(chainIds, p, "0x2::sui::SUI", mist!) : createObjectGiveawayTx(chainIds, p, objectType.trim(), ids);
      setBusy("Confirm in your wallet…");
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res.$kind === "FailedTransaction") throw new Error(res.FailedTransaction.status.error?.message ?? "The transaction failed.");
      const id = createdCampaignId(res.Transaction.effects);
      if (!id) throw new Error(`Created, but the giveaway ID was not found in transaction ${res.Transaction.digest}.`);
      navigate(`/g/${id}/post`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const cost = estimateXCostUsd(500);
  return (
    <form className="create" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1>Create a giveaway</h1>
      <fieldset>
        <legend>How winners are picked</legend>
        <div className="toggle" role="radiogroup">
          <button type="button" role="radio" aria-checked={form.mode === "draw"} className={form.mode === "draw" ? "on" : ""} onClick={() => set("mode", "draw")}>
            <strong>Random Draw</strong>
            <span>Every reply that meets the rules has an equal chance.</span>
          </button>
          <button type="button" role="radio" aria-checked={form.mode === "judged"} className={form.mode === "judged" ? "on" : ""} onClick={() => set("mode", "judged")}>
            <strong>Judged Draw</strong>
            <span>An AI judge marks each reply pass or fail against your rubric, then winners are drawn at random from the passes.</span>
          </button>
        </div>
        {form.mode === "judged" && (
          <Field label="Rubric" hint="One plain sentence the judge applies to each reply, like “The reply includes an original drawing of a cat.” It is published with the rules.">
            <textarea rows={3} value={form.rubric} onChange={(e) => set("rubric", e.target.value)} maxLength={2000} />
          </Field>
        )}
      </fieldset>

      <fieldset>
        <legend>Prize</legend>
        <Field label="Winners">
          <input type="number" min={1} max={100} value={k} onChange={(e) => setK(Number(e.target.value))} />
        </Field>
        <div className="toggle compact" role="radiogroup">
          <button type="button" role="radio" aria-checked={prizeKind === "coin"} className={prizeKind === "coin" ? "on" : ""} onClick={() => setPrizeKind("coin")}>SUI</button>
          <button type="button" role="radio" aria-checked={prizeKind === "objects"} className={prizeKind === "objects" ? "on" : ""} onClick={() => setPrizeKind("objects")}>NFTs / objects</button>
        </div>
        {prizeKind === "coin" ? (
          <Field label="Total prize (SUI)" hint={mist !== null && k > 0 ? `Each winner gets about ${fmtSui(mist / BigInt(k))} SUI.` : undefined}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="Object type">
              <input value={objectType} onChange={(e) => setObjectType(e.target.value)} placeholder="0x…::nft::Nft" className="mono" />
            </Field>
            <Field label={`Object IDs (${ids.length}/${k})`} hint="One per line. The first goes to winner #1, and so on.">
              <textarea rows={Math.min(6, Math.max(2, k))} value={objectIds} onChange={(e) => setObjectIds(e.target.value)} className="mono" />
            </Field>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Who can enter</legend>
        <Field label="Closes">
          <input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
        </Field>
        <Field label="Minimum X account age (days)">
          <input type="number" min={0} value={form.minAccountAgeDays} onChange={(e) => set("minAccountAgeDays", Number(e.target.value))} />
        </Field>
        <Field label="Minimum followers">
          <input type="number" min={0} value={form.minFollowers} onChange={(e) => set("minFollowers", Number(e.target.value))} />
        </Field>
        <Field label="Required text" hint="Comma-separated; the reply must contain each, ignoring case. Leave empty for none.">
          <input value={form.requiredText} onChange={(e) => set("requiredText", e.target.value)} placeholder="#sui, gm" />
        </Field>
        <label className="check"><input type="checkbox" checked={form.requireMedia} onChange={(e) => set("requireMedia", e.target.checked)} /> Reply must include an image or video</label>
        <label className="check"><input type="checkbox" checked={form.directRepliesOnly} onChange={(e) => set("directRepliesOnly", e.target.checked)} /> Only direct replies to the post</label>
        <Field label="Exclude X user IDs" hint="Team or partner accounts, as numeric IDs. Your own account is always excluded.">
          <input value={form.excludeAuthorIds} onChange={(e) => set("excludeAuthorIds", e.target.value)} className="mono" />
        </Field>
      </fieldset>

      <section className="summary">
        <p>
          Chek fee: <strong>{fee.data === undefined ? "…" : `${fmtSui(fee.data)} SUI`}</strong> plus gas. The X data for a snapshot of 500 replies costs Chek
          about ${cost.low.toFixed(2)}–${cost.high.toFixed(2)}.
        </p>
        <p className="small muted">The prize is locked in the giveaway when you create it. If no snapshot is committed within 48 hours of closing, anyone can return it to you.</p>
        {problems.length > 0 && (
          <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        {error !== null && <ErrorBox error={error} />}
        {config.demo ? (
          <p className="muted">Creating is off in demo mode.</p>
        ) : !account ? (
          <p>Connect a wallet to create.</p>
        ) : (
          <button type="submit" disabled={problems.length > 0 || busy !== null}>{busy ?? "Create and lock prize"}</button>
        )}
      </section>
    </form>
  );
}
