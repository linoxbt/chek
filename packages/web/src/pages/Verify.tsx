import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Mode, Status } from "@chek/core";
import { lookupEntrant, verifyCampaign, type VerifyReport } from "../lib/verify-page.ts";
import { explorerObj, explorerTx, reader, short, xPost } from "../lib/app.ts";
import { ErrorBox, Loading, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";
import { Console } from "../components/Console.tsx";
import { Dot, StatusWord, Tag } from "../components/ui.tsx";

export function Verify() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["verify", id], queryFn: () => verifyCampaign(reader, id) });
  if (q.isPending) return <div className="wrap section-sm"><Loading what="the giveaway and running checks" /></div>;
  if (q.error) return <div className="wrap section-sm"><ErrorBox error={q.error} /></div>;
  const r = q.data;
  const c = r.campaign;
  return (
    <article className="verify">
      <section className="hero hero-sm">
        <div className="halftone" aria-hidden />
        <div className="wrap">
          <div className="row">
            <StatusBadge status={c.status} />
            <span className="mono-label">{modeName(c.mode)}</span>
          </div>
          <h1 className="page-title">{prizeText(c)} <span className="dim-h">for {c.k} winner{c.k === 1 ? "" : "s"}</span></h1>
          <p className="lede">{summary(r)}</p>
          <div className="actions">
            {c.postId !== "0" && <a className="btn dark small" href={xPost(c.postId)}>Post on X ↗</a>}
            <a className="btn dark small" href={explorerObj(c.id)}>Giveaway on Sui ↗</a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <Console report={r} url={`chek-giveaways.netlify.app/g/${short(c.id)}`} chrome={false} />

        <div className="two">
          {r.doc && <Lookup report={r} />}
          {r.winners.length > 0 && (
            <section className="card">
              <header className="card-head"><span className="mono-label">Winners</span><span className="mono-label">drawn by Sui Random</span></header>
              <ol className="winners">
                {r.winners.map((w) => (
                  <li key={w.rank}>
                    <span className="step-num mono small-num">{String(w.rank).padStart(2, "0")}</span>
                    <span className="who">
                      <strong>@{w.entrant?.handle ?? "?"}</strong>
                      <span className="mono dim small">{w.entrant ? short(w.entrant.address) : ""}</span>
                    </span>
                    {w.payout ? <a href={explorerTx(w.payout.digest)}><StatusWord tone="ok">paid</StatusWord></a> : <StatusWord tone={c.paid[w.rank - 1] ? "ok" : "warn"}>{c.paid[w.rank - 1] ? "paid" : "pending"}</StatusWord>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <section className="section-sm">
          <Tag>Checked in your browser</Tag>
          <h2>Every step, verified.</h2>
          <p className="lede">These ran just now using only the Sui chain and Walrus storage. Chek's servers weren't asked anything.</p>
          <div className="card checks-card">
            <header className="card-head"><span className="mono-label">Full trace · {r.checks.length} checks</span><span className={`mono-label ${r.ok ? "ok-label" : "bad-label"}`}><Dot tone={r.ok ? "ok" : "bad"} /> {r.ok ? "all passing" : "attention"}</span></header>
            <ol className="checks">
              {r.checks.map((k, i) => (
                <li key={k.id} className={k.state}>
                  <span className="mono dim">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{k.title}</strong>
                    <p>{k.detail}</p>
                  </div>
                  <StatusWord tone={k.state === "pass" ? "ok" : k.state === "fail" ? "bad" : "warn"}>{k.state}</StatusWord>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {r.enclave && (
          <details className="card tech">
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
            <p className="small dim">
              To compare the PCRs with a build of the published source, see <a href="https://github.com/linoxbt/chek/blob/main/docs/enclave-spike.md">the reproducible build guide</a>.
            </p>
          </details>
        )}
        <p className="back"><Link to="/">← All giveaways</Link></p>
      </div>
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
    <section className="card lookup">
      <header className="card-head"><span className="mono-label">Was I counted?</span><span className="mono-label">search the snapshot</span></header>
      <input placeholder="@handle, Sui address or your reply's link" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an entry" />
      {res?.kind === "entrant" && (
        <p className="ok">
          @{res.entrant.handle} is entrant #{res.entrant.i + 1} with address <span className="mono">{short(res.entrant.address)}</span>
          {res.entrant.via === "suins" ? " (from a SuiNS name)" : ""}.{res.winnerRank ? ` Winner #${res.winnerRank}!` : ""}
        </p>
      )}
      {res?.kind === "excluded" && (
        <p className="bad">
          That reply was not counted: {res.text} <span className="mono dim small">({res.code})</span>
        </p>
      )}
      {res?.kind === "none" && <p className="dim">No match. If you think your reply was left out, paste its link: excluded replies are listed by link only.</p>}
    </section>
  );
}
