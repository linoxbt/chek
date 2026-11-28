import { Link } from "react-router";
import { Status, type Campaign } from "@chek/core";
import { countdown, useNow } from "../lib/time.ts";
import { modeName, prizeText, StatusBadge, when } from "./bits.tsx";
import { Empty } from "./states.tsx";

/** Console-style table of giveaways; open ones count down live. */
export function GiveawayTable({ rows, empty, draftsToPost = false }: { rows: Campaign[]; empty: { title: string; text?: string; action?: { to: string; label: string } }; draftsToPost?: boolean }) {
  const now = useNow(1000);
  if (rows.length === 0) return <Empty title={empty.title} action={empty.action}>{empty.text}</Empty>;
  return (
    <div className="gtable" role="table" aria-label="Giveaways">
      <div className="gt-row gt-head mono-label" role="row">
        <span role="columnheader">Status</span>
        <span role="columnheader">Prize</span>
        <span role="columnheader">Mode</span>
        <span role="columnheader">Entrants</span>
        <span role="columnheader">Closes</span>
      </div>
      {rows.map((c) => {
        const to = draftsToPost && c.status === Status.DRAFT ? `/g/${c.id}/post` : `/g/${c.id}`;
        const live = (c.status === Status.OPEN || c.status === Status.DRAFT) && c.closesAt > now;
        return (
          <Link key={c.id} to={to} className="gt-row" role="row">
            <span role="cell"><StatusBadge status={c.status} /></span>
            <span role="cell" className="gt-prize">{prizeText(c)} <span className="dim">· {c.k} winner{c.k === 1 ? "" : "s"}</span></span>
            <span role="cell" className="dim">{modeName(c.mode)}</span>
            <span role="cell" className="mono">{c.snapshot ? `${c.snapshot.n} / ${c.snapshot.repliesSeen}` : "—"}</span>
            <span role="cell" className={`mono ${live ? "count" : "dim"}`}>{live ? `in ${countdown(c.closesAt, now)}` : when(c.closesAt)}</span>
          </Link>
        );
      })}
    </div>
  );
}
