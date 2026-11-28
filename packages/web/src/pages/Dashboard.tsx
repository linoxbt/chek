import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status, type Campaign } from "@chek/core";
import { fmtSui, reader } from "../lib/app.ts";
import { countdown, relTime, useNow } from "../lib/time.ts";
import { verifyCampaign } from "../lib/verify-page.ts";
import { ErrorBox, prizeText } from "../components/bits.tsx";
import { Console } from "../components/Console.tsx";
import { GiveawayTable } from "../components/GiveawayTable.tsx";
import { Empty, Skeleton, SkeletonPage } from "../components/states.tsx";
import { Dot, StatusWord, type Tone } from "../components/ui.tsx";

interface Ev { t: number; what: string; c: Campaign; tone: Tone; word: string }

/** Lifecycle events with known times, newest first. */
function activity(all: Campaign[], now: number): Ev[] {
  const out: Ev[] = [];
  for (const c of all) {
    out.push({ t: c.createdAt, what: "Prize locked", c, tone: "ok", word: "escrowed" });
    if (c.openedAt) out.push({ t: c.openedAt, what: "Opened on X", c, tone: "ok", word: "open" });
    if (c.closesAt <= now && c.status !== Status.CANCELLED && c.status !== Status.DRAFT) out.push({ t: c.closesAt, what: "Entries closed", c, tone: "warn", word: "closed" });
    if (c.snapshot) out.push({ t: c.snapshot.fetchedAt, what: `Snapshot sealed · ${c.snapshot.n} entrants`, c, tone: "ok", word: "signed" });
  }
  return out.filter((e) => e.t <= now).sort((a, b) => b.t - a.t);
}

export function Dashboard() {
  const now = useNow(1000);
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const featured = list.data?.find((c) => c.status === Status.SETTLED);
  const proof = useQuery({ queryKey: ["verify", featured?.id], enabled: !!featured, queryFn: () => verifyCampaign(reader, featured!.id) });
  if (list.isPending) return <SkeletonPage />;
  if (list.error) return <ErrorBox error={list.error} />;

  const all = list.data.filter((c) => c.status !== Status.DRAFT);
  const open = all.filter((c) => c.status === Status.OPEN).sort((a, b) => a.closesAt - b.closesAt);
  const settled = all.filter((c) => c.status === Status.SETTLED);
  const locked = open.filter((c) => c.prizeKind === 0 && c.coinType === "0x2::sui::SUI").reduce((s, c) => s + c.pool, 0n);
  const entrants = all.reduce((s, c) => s + (c.snapshot?.n ?? 0), 0);
  const tiles = [
    { k: "Open now", v: String(open.length), sub: open[0] ? `next closes in ${countdown(open[0].closesAt, now)}` : "none taking replies" },
    { k: "SUI locked", v: fmtSui(locked), sub: "in open escrows" },
    { k: "Paid out", v: String(settled.length), sub: "settled draws" },
    { k: "Entrants verified", v: String(entrants), sub: "across all snapshots" },
  ];
  const feed = activity(list.data, now).slice(0, 7);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="app-title">Overview</h1>
          <p className="dim">Every giveaway on Chek, read straight from the chain.</p>
        </div>
        <Link className="btn coral small" to="/create">New giveaway <span aria-hidden>→</span></Link>
      </div>

      <div className="tiles stat-tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.k}>
            <span className="mono-label">{t.k}</span>
            <strong className="tile-v">{t.v}</strong>
            <span className="mono small dim">{t.sub}</span>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <section className="card">
          <header className="card-head"><span className="mono-label">Closing soon</span><span className="mono-label ok-label"><Dot /> live</span></header>
          {open.length === 0 ? (
            <Empty title="Nothing open right now">Open giveaways count down here.</Empty>
          ) : (
            <ul className="soon">
              {open.slice(0, 4).map((c) => {
                const total = c.closesAt - (c.openedAt || c.createdAt);
                const left = Math.max(0, c.closesAt - now);
                const pct = total > 0 ? Math.min(100, 100 - (left / total) * 100) : 100;
                return (
                  <li key={c.id}>
                    <Link to={`/g/${c.id}`}>
                      <div className="row between"><strong>{prizeText(c)}</strong><span className="mono count">{countdown(c.closesAt, now)}</span></div>
                      <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
                      <span className="mono small dim">{c.k} winner{c.k === 1 ? "" : "s"} · {Math.round(pct)}% of entry window gone</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card">
          <header className="card-head"><span className="mono-label">Recent activity</span><span className="mono-label">on-chain</span></header>
          {feed.length === 0 ? (
            <Empty title="No activity yet" />
          ) : (
            <ul className="feed">
              {feed.map((e, i) => (
                <li key={i}>
                  <span className="mono dim t">{relTime(e.t, now)}</span>
                  <Link to={`/g/${e.c.id}`}>{e.what} <span className="dim">· {prizeText(e.c)}</span></Link>
                  <StatusWord tone={e.tone}>{e.word}</StatusWord>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="block">
        <div className="block-head">
          <h2 className="h-block">Latest verified draw</h2>
          {proof.data && <Link className="mono small" to={`/g/${proof.data.campaign.id}`}>open →</Link>}
        </div>
        {proof.data ? <Console report={proof.data} chrome={false} /> : featured ? <div className="card"><Skeleton h={180} /></div> : <Empty title="No settled draws yet">The first finished giveaway will show its proof here.</Empty>}
      </section>

      <section className="block">
        <div className="block-head">
          <h2 className="h-block">Recent giveaways</h2>
          <Link className="mono small" to="/giveaways">all {all.length} →</Link>
        </div>
        <GiveawayTable rows={all.slice(0, 6)} empty={{ title: "No giveaways yet", text: "Create the first one.", action: { to: "/create", label: "New giveaway" } }} />
      </section>
    </div>
  );
}
