import { Link } from "react-router";
import { Status, type Campaign } from "@chek/core";
import { modeName, prizeText, StatusBadge, when } from "./bits.tsx";

/** Console-style table of giveaways; each row opens the giveaway (or its post step for drafts you own). */
export function GiveawayTable({ rows, empty, draftsToPost = false }: { rows: Campaign[]; empty: string; draftsToPost?: boolean }) {
  if (rows.length === 0) return <p className="dim table-empty">{empty}</p>;
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
        return (
          <Link key={c.id} to={to} className="gt-row" role="row">
            <span role="cell"><StatusBadge status={c.status} /></span>
            <span role="cell" className="gt-prize">{prizeText(c)} <span className="dim">· {c.k} winner{c.k === 1 ? "" : "s"}</span></span>
            <span role="cell" className="dim">{modeName(c.mode)}</span>
            <span role="cell" className="mono">{c.snapshot ? `${c.snapshot.n} / ${c.snapshot.repliesSeen}` : "—"}</span>
            <span role="cell" className="mono dim">{when(c.closesAt)}</span>
          </Link>
        );
      })}
    </div>
  );
}
