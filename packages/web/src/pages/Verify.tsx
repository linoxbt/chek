import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Mode, Status, type ReasonCode } from "@chek/core";
import { lookupEntrant, REASON_TEXT, verifyCampaign, type VerifyReport } from "../lib/verify-page.ts";
import { config } from "../lib/config.ts";
import { countdown, useNow } from "../lib/time.ts";
import { Empty, Skeleton, SkeletonTiles } from "../components/states.tsx";
import { explorerObj, explorerTx, reader, short, xPost } from "../lib/app.ts";
import { Copy, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";
import { Console } from "../components/Console.tsx";
import { Dot, StatusWord } from "../components/ui.tsx";

type TabKey = "summary" | "entrants" | "checks" | "details";

export function Verify() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);
  const q = useQuery({ queryKey: ["verify", id], queryFn: () => verifyCampaign(reader, id) });
  if (q.isPending) return <VerifySkeleton />;
  if (q.error) return <Empty title="Couldn't load this giveaway">{q.error instanceof Error ? q.error.message : String(q.error)}</Empty>;
  const r = q.data;
  const c = r.campaign;
  const failed = r.checks.filter((k) => k.state === "fail").length;
  const tabs: { key: TabKey; label: string; count?: string }[] = [
    { key: "summary", label: "Summary" },
    ...(r.doc ? [{ key: "entrants" as const, label: "Entrants", count: String(r.doc.entrants.length + r.doc.excluded.length) }] : []),
    { key: "checks", label: "Checks", count: failed ? `${failed} failed` : `${r.checks.filter((k) => k.state === "pass").length}/${r.checks.length}` },
    { key: "details", label: "Details" },
  ];
  const tab = (tabs.find((t) => t.key === params.get("tab"))?.key ?? "summary") as TabKey;
  const open = c.status === Status.OPEN && c.closesAt > now;

  return (
    <article className="verify">
      <section className="hero hero-sm">
        <div className="halftone" aria-hidden />
        <div className="wrap">
          <div className="row">
            <StatusBadge status={c.status} />
            <span className="mono-label">{modeName(c.mode)}</span>
            {open && <span className="mono-label count">closes in {countdown(c.closesAt, now)}</span>}
          </div>
          <h1 className="page-title">{prizeText(c)} <span className="dim-h">for {c.k} winner{c.k === 1 ? "" : "s"}</span></h1>
          <p className="lede">{summary(r)}</p>
          <div className="actions">
            {c.postId !== "0" && <a className="btn dark small" href={xPost(c.postId)}>Post on X ↗</a>}
            <a className="btn dark small" href={explorerObj(c.id)}>Giveaway on Sui ↗</a>
            <Copy text={`${config.linkOrigin}/g/${c.id}`} label="Copy link" />
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="tabs page-tabs" role="tablist" aria-label="Giveaway sections">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setParams(t.key === "summary" ? {} : { tab: t.key }, { replace: true })}>
              {t.label} {t.count && <span className="mono">{t.count}</span>}
            </button>
          ))}
        </div>

        {tab === "summary" && (
          <>
            <Console report={r} chrome={false} />
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
          </>
        )}

        {tab === "entrants" && r.doc && <Entrants report={r} />}

        {tab === "checks" && (
          <section>
            <p className="dim">These ran just now using only the Sui chain and Walrus storage. Chek's servers weren't asked anything.</p>
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
        )}

        {tab === "details" && (
          <section className="card tech">
            <header className="card-head"><span className="mono-label">On-chain and Walrus references</span></header>
            <dl>
              <dt>Giveaway object</dt>
              <dd className="mono"><a href={explorerObj(c.id)}>{c.id}</a></dd>
              <dt>Organizer</dt>
              <dd className="mono">{c.organizer}</dd>
              <dt>Rules</dt>
              <dd className="mono">{c.rulesBlob} (hash {c.rulesHash})</dd>
              {c.snapshot && (
                <>
                  <dt>Snapshot file</dt>
                  <dd className="mono">{c.snapshot.blobId}</dd>
                  <dt>Merkle root</dt>
                  <dd className="mono">{c.snapshot.root}</dd>
                </>
              )}
              {r.enclave && (
                <>
                  <dt>Enclave</dt>
                  <dd className="mono"><a href={explorerObj(r.enclave.id)}>{r.enclave.id}</a> (config version {r.enclave.configVersion})</dd>
                  <dt>Enclave key</dt>
                  <dd className="mono">{r.enclave.publicKey}</dd>
                  {r.enclave.config.version === c.enclaveVersion &&
                    r.enclave.config.pcrs.map((p, i) => (
                      <div key={i} className="contents">
                        <dt>PCR{i}</dt>
                        <dd className="mono">{p}</dd>
                      </div>
                    ))}
                </>
              )}
            </dl>
            <p className="small dim">
              To compare the PCRs with a build of the published source, see <a href="https://github.com/linoxbt/chek/blob/main/docs/enclave-spike.md">the reproducible build guide</a>.
            </p>
          </section>
        )}
        <p className="back"><Link to="/giveaways">← All giveaways</Link></p>
      </div>
    </article>
  );
}

const PAGE = 25;

/** Every entrant (with winners marked) and every excluded reply with its reason. */
function Entrants({ report }: { report: VerifyReport }) {
  const doc = report.doc!;
  const [view, setView] = useState<"in" | "out">("in");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const t = term.trim().toLowerCase().replace(/^@/, "");
  const winners = report.campaign.winners;
  const ins = doc.entrants.filter((e) => !t || e.handle.toLowerCase().includes(t) || e.address.includes(t) || e.reply_id.includes(t));
  const outs = doc.excluded.filter((x) => !t || x.reply_id.includes(t) || x.code.toLowerCase().includes(t));
  const rows = view === "in" ? ins : outs;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  return (
    <section>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === "in"} className={view === "in" ? "on" : ""} onClick={() => { setView("in"); setPage(0); }}>Counted <span className="mono">{doc.entrants.length}</span></button>
          <button type="button" role="tab" aria-selected={view === "out"} className={view === "out" ? "on" : ""} onClick={() => { setView("out"); setPage(0); }}>Not counted <span className="mono">{doc.excluded.length}</span></button>
        </div>
        <div className="toolbar-right">
          <input className="search" value={term} onChange={(e) => { setTerm(e.target.value); setPage(0); }} placeholder={view === "in" ? "Filter by @handle, address or reply" : "Filter by reply ID or reason"} aria-label="Filter entrants" />
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No matches">{view === "out" && doc.excluded.length === 0 ? "Every reply met the rules." : "Try a different filter."}</Empty>
      ) : view === "in" ? (
        <div className="gtable etable" role="table" aria-label="Entrants">
          <div className="et-row gt-head mono-label" role="row"><span>#</span><span>Entrant</span><span>Address</span><span>Via</span><span>Result</span></div>
          {(rows as typeof ins).slice(p * PAGE, p * PAGE + PAGE).map((e) => {
            const rank = winners.indexOf(e.i);
            return (
              <div className="et-row" role="row" key={e.i}>
                <span className="mono dim">{String(e.i + 1).padStart(3, "0")}</span>
                <span><a href={`https://x.com/i/status/${e.reply_id}`}>@{e.handle}</a></span>
                <span className="mono dim">{short(e.address)}</span>
                <span className="mono dim">{e.via}{e.verdict === "pass" && doc.ai ? " · ai pass" : ""}</span>
                <span>{rank >= 0 ? <StatusWord tone="ok">{`winner #${rank + 1}`}</StatusWord> : <StatusWord tone="idle">entrant</StatusWord>}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="gtable etable" role="table" aria-label="Replies not counted">
          <div className="et-row out gt-head mono-label" role="row"><span>Reply</span><span>Reason</span><span>Code</span></div>
          {(rows as typeof outs).slice(p * PAGE, p * PAGE + PAGE).map((x) => (
            <div className="et-row out" role="row" key={x.reply_id}>
              <span className="mono"><a href={`https://x.com/i/status/${x.reply_id}`}>…{x.reply_id.slice(-8)}</a></span>
              <span className="dim">{x.reason ?? REASON_TEXT[x.code as ReasonCode] ?? x.code}</span>
              <span><StatusWord tone="bad">{x.code.toLowerCase()}</StatusWord></span>
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="pager mono">
          <button type="button" className="btn dark small" disabled={p === 0} onClick={() => setPage(p - 1)}>← prev</button>
          <span className="dim">page {p + 1} of {pages}</span>
          <button type="button" className="btn dark small" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>next →</button>
        </div>
      )}
    </section>
  );
}

function VerifySkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton h={22} w={140} r={999} />
      <div style={{ height: 16 }} />
      <Skeleton h={44} w="55%" />
      <div style={{ height: 12 }} />
      <Skeleton h={14} w="70%" />
      <div style={{ height: 28 }} />
      <SkeletonTiles />
      <div style={{ height: 12 }} />
      <div className="card"><Skeleton h={160} /></div>
      <p className="mono small dim" style={{ marginTop: 14 }}>Reading the chain and Walrus, then running every check in your browser…</p>
    </div>
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
