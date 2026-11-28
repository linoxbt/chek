import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Status, type Campaign } from "@chek/core";
import { prizeText } from "../components/bits.tsx";
import { reader } from "../lib/app.ts";
import { ErrorBox } from "../components/bits.tsx";
import { GiveawayTable } from "../components/GiveawayTable.tsx";
import { SkeletonRows } from "../components/states.tsx";

const FILTERS: { key: string; label: string; test: (c: Campaign) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "open", label: "Open", test: (c) => c.status === Status.OPEN },
  { key: "drawing", label: "Drawing", test: (c) => c.status === Status.COMMITTED || c.status === Status.DRAWN },
  { key: "settled", label: "Paid out", test: (c) => c.status === Status.SETTLED },
  { key: "ended", label: "Refunded", test: (c) => c.status === Status.EXPIRED || c.status === Status.CANCELLED },
];
const SORTS: Record<string, { label: string; cmp: (a: Campaign, b: Campaign) => number }> = {
  newest: { label: "Newest", cmp: (a, b) => b.createdAt - a.createdAt },
  closing: { label: "Closing soonest", cmp: (a, b) => a.closesAt - b.closesAt },
  prize: { label: "Biggest prize", cmp: (a, b) => (b.pool + b.perWinner * BigInt(b.winners.length) > a.pool + a.perWinner * BigInt(a.winners.length) ? 1 : -1) },
  entrants: { label: "Most entrants", cmp: (a, b) => (b.snapshot?.n ?? -1) - (a.snapshot?.n ?? -1) },
};

export function Giveaways() {
  const q = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const [f, setF] = useState("all");
  const [sort, setSort] = useState("newest");
  const [term, setTerm] = useState("");
  const all = useMemo(() => (q.data ?? []).filter((c) => c.status !== Status.DRAFT), [q.data]);
  const filter = FILTERS.find((x) => x.key === f)!;
  const t = term.trim().toLowerCase();
  const rows = all
    .filter(filter.test)
    .filter((c) => !t || c.id.includes(t) || prizeText(c).toLowerCase().includes(t) || c.postId.includes(t))
    .sort(SORTS[sort]!.cmp);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="app-title">Giveaways</h1>
          <p className="dim">Open one to see its entrants, its draw and every check.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={f === x.key} className={f === x.key ? "on" : ""} onClick={() => setF(x.key)}>
              {x.label} <span className="mono">{all.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <input className="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter by ID, prize or post" aria-label="Filter giveaways" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      {q.isPending ? <SkeletonRows n={5} /> : q.error ? <ErrorBox error={q.error} /> : (
        <GiveawayTable rows={rows} empty={t ? { title: "No matches", text: "Try another ID or clear the filter." } : { title: "Nothing here yet", text: "Giveaways in this state will show up here.", action: { to: "/create", label: "New giveaway" } }} />
      )}
    </div>
  );
}
