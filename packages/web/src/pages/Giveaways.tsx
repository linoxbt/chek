import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Status, type Campaign } from "@chek/core";
import { reader } from "../lib/app.ts";
import { ErrorBox, Loading } from "../components/bits.tsx";
import { GiveawayTable } from "../components/GiveawayTable.tsx";

const FILTERS: { key: string; label: string; test: (c: Campaign) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "open", label: "Open", test: (c) => c.status === Status.OPEN },
  { key: "drawing", label: "Drawing", test: (c) => c.status === Status.COMMITTED || c.status === Status.DRAWN },
  { key: "settled", label: "Paid out", test: (c) => c.status === Status.SETTLED },
  { key: "ended", label: "Refunded", test: (c) => c.status === Status.EXPIRED || c.status === Status.CANCELLED },
];

export function Giveaways() {
  const q = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const [f, setF] = useState("all");
  if (q.isPending) return <Loading what="giveaways" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const all = q.data.filter((c) => c.status !== Status.DRAFT);
  const filter = FILTERS.find((x) => x.key === f)!;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="app-title">Giveaways</h1>
          <p className="dim">Open one to see its entrants, its draw and every check.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {FILTERS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={f === x.key} className={f === x.key ? "on" : ""} onClick={() => setF(x.key)}>
            {x.label} <span className="mono">{all.filter(x.test).length}</span>
          </button>
        ))}
      </div>
      <GiveawayTable rows={all.filter(filter.test)} empty="Nothing here yet." />
    </div>
  );
}
