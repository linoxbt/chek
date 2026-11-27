import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Mode, Status } from "@chek/core";
import { lookupEntrant, verifyCampaign, type VerifyReport } from "../lib/verify-page.ts";
import { explorerObj, explorerTx, reader, short, xPost } from "../lib/app.ts";
import { ErrorBox, Loading, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";

export function Verify() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["verify", id], queryFn: () => verifyCampaign(reader, id) });
  if (q.isPending) return <Loading what="the giveaway and running checks" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  const c = r.campaign;
  return (
    <article className="verify">
      <div className="row">
        <StatusBadge status={c.status} />
        <span className="muted small">{modeName(c.mode)}</span>
      </div>
      <h1>{prizeText(c)} for {c.k} winner{c.k === 1 ? "" : "s"}</h1>
      <p className="lead">{summary(r)}</p>
      <dl className="facts">
        <dt>Post</dt>
        <dd>{c.postId !== "0" ? <a href={xPost(c.postId)}>View on X</a> : "Not posted yet"}</dd>
        <dt>Closes</dt>
        <dd>{when(c.closesAt)}</dd>
        <dt>Giveaway</dt>
        <dd><a href={explorerObj(c.id)}>{short(c.id)}</a></dd>
      </dl>

      {r.doc && <Lookup report={r} />}

      {r.winners.length > 0 && (
        <section>
          <h2>Winners</h2>
          <ol className="winners">
            {r.winners.map((w) => (
              <li key={w.rank}>
                <span className="rank">#{w.rank}</span>
                <span>
                  <strong>@{w.entrant?.handle ?? "?"}</strong>
                  <span className="mono small">{w.entrant ? short(w.entrant.address) : ""}</span>
                </span>
                <span className="small">
                  {w.payout ? <a href={explorerTx(w.payout.digest)}>Paid</a> : c.paid[w.rank - 1] ? "Paid" : "Pending"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h2>Checks</h2>
        <p className="muted small">Your browser ran these just now, using only the Sui chain and Walrus storage. Chek's servers were not asked.</p>
        <ul className="checks">
          {r.checks.map((k) => (
            <li key={k.id} className={k.state}>
              <span className="icon" aria-label={k.state}>{k.state === "pass" ? "✓" : k.state === "fail" ? "✕" : "…"}</span>
              <div>
                <strong>{k.title}</strong>
                <p>{k.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {r.enclave && (
        <details className="tech">
          <summary>Technical details</summary>
          <dl>
            <dt>Enclave</dt>
            <dd><a href={explorerObj(r.enclave.id)}>{short(r.enclave.id)}</a> (config version {r.enclave.configVersion})</dd>
            <dt>Enclave key</dt>
            <dd className="mono">{r.enclave.publicKey}</dd>
            {r.enclave.config.version === c.enclaveVersion &&
              r.enclave.config.pcrs.map((p, i) => (
                <div key={i} className="contents">
                  <dt>PCR{i}</dt>
                  <dd className="mono">{p}</dd>
                </div>
              ))}
            <dt>Merkle root</dt>
            <dd className="mono">{c.snapshot?.root}</dd>
            <dt>Rules</dt>
            <dd className="mono">{c.rulesBlob} (hash {c.rulesHash})</dd>
            <dt>Snapshot file</dt>
            <dd className="mono">{c.snapshot?.blobId}</dd>
          </dl>
          <p className="small">
            To compare PCRs with a build of the published source, see <a href="https://github.com/linoxbt/chek/blob/main/docs/enclave-spike.md">the reproducible build guide</a>.
          </p>
        </details>
      )}
      <p><Link to="/">← All giveaways</Link></p>
    </article>
  );
}

function summary(r: VerifyReport): string {
  const c = r.campaign;
  const s = c.snapshot;
  if (c.status === Status.DRAFT) return "This giveaway is being set up. Its prize is locked but it has not been posted on X yet.";
  if (c.status === Status.CANCELLED) return "The organizer cancelled this giveaway before it opened, and the prize went back to them.";
  if (c.status === Status.EXPIRED) return "No snapshot was committed within 48 hours of closing, so the prize went back to the organizer. Nobody was picked.";
  if (c.status === Status.OPEN) return `Open until ${when(c.closesAt)}. Reply to the post with your Sui address or SuiNS name to enter. The prize is locked on-chain until then.`;
  if (!s) return "";
  const how = c.mode === Mode.JUDGED ? `${s.n} replies passed the rules and the AI judge` : `${s.n} replies met the rules`;
  const head = `${s.repliesSeen} people replied and ${how}.`;
  if (!r.ok) return `${head} Some checks below failed, so don't trust this result until they are explained.`;
  if (c.status === Status.COMMITTED) return `${head} The draw comes next.`;
  if (s.n === 0) return `${head} With no entrants, the prize goes back to the organizer.`;
  return `${head} ${r.winners.length} winner${r.winners.length === 1 ? " was" : "s were"} drawn at random on-chain. Every check below passed.`;
}

function Lookup({ report }: { report: VerifyReport }) {
  const [q, setQ] = useState("");
  const res = q ? lookupEntrant(report.doc!, report.campaign.winners, q) : null;
  return (
    <section className="lookup">
      <h2>Was I counted?</h2>
      <input placeholder="@handle, Sui address or your reply's link" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an entry" />
      {res?.kind === "entrant" && (
        <p className="good">
          @{res.entrant.handle} is entrant #{res.entrant.i + 1} with address <span className="mono">{short(res.entrant.address)}</span>
          {res.entrant.via === "suins" ? " (from a SuiNS name)" : ""}.{res.winnerRank ? ` Winner #${res.winnerRank}!` : ""}
        </p>
      )}
      {res?.kind === "excluded" && (
        <p className="bad">
          That reply was not counted: {res.text} <span className="muted small">({res.code})</span>
        </p>
      )}
      {res?.kind === "none" && <p className="muted">No match. If you think your reply was left out, paste its link: excluded replies are listed by link only.</p>}
    </section>
  );
}
