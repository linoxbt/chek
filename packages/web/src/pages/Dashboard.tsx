import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status } from "@chek/core";
import { fmtSui, reader } from "../lib/app.ts";
import { verifyCampaign } from "../lib/verify-page.ts";
import { ErrorBox, Loading } from "../components/bits.tsx";
import { Console } from "../components/Console.tsx";
import { GiveawayTable } from "../components/GiveawayTable.tsx";
import { Dot } from "../components/ui.tsx";

export function Dashboard() {
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const featured = list.data?.find((c) => c.status === Status.SETTLED);
  const proof = useQuery({ queryKey: ["verify", featured?.id], enabled: !!featured, queryFn: () => verifyCampaign(reader, featured!.id) });
  if (list.isPending) return <Loading what="giveaways" />;
  if (list.error) return <ErrorBox error={list.error} />;

  const all = list.data.filter((c) => c.status !== Status.DRAFT);
  const open = all.filter((c) => c.status === Status.OPEN);
  const settled = all.filter((c) => c.status === Status.SETTLED);
  const locked = open.filter((c) => c.prizeKind === 0 && c.coinType === "0x2::sui::SUI").reduce((s, c) => s + c.pool, 0n);
  const entrants = all.reduce((s, c) => s + (c.snapshot?.n ?? 0), 0);
  const tiles = [
    { k: "Open now", v: String(open.length), sub: "taking replies" },
    { k: "SUI locked", v: fmtSui(locked), sub: "in open escrows" },
    { k: "Paid out", v: String(settled.length), sub: "settled draws" },
    { k: "Entrants verified", v: String(entrants), sub: "across all snapshots" },
  ];

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

      {proof.data && (
        <section className="block">
          <div className="block-head">
            <h2 className="h-block">Latest verified draw</h2>
            <Link className="mono small" to={`/g/${proof.data.campaign.id}`}>open →</Link>
          </div>
          <Console report={proof.data} chrome={false} />
        </section>
      )}

      <section className="block">
        <div className="block-head">
          <h2 className="h-block">Recent giveaways</h2>
          <span className="mono-label ok-label"><Dot /> live</span>
        </div>
        <GiveawayTable rows={all.slice(0, 8)} empty="No giveaways yet." />
        {all.length > 8 && <Link className="mono small" to="/giveaways">all {all.length} giveaways →</Link>}
      </section>
    </div>
  );
}
