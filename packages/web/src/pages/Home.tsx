import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status } from "@chek/core";
import { reader } from "../lib/app.ts";
import { ErrorBox, Loading, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";

export function Home() {
  const q = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  return (
    <>
      <section className="hero">
        <h1>Giveaways anyone can check</h1>
        <p>
          The prize is locked on Sui before the giveaway starts. When it closes, a sealed enclave records every reply, and Sui's
          on-chain randomness picks the winners. The prizes go straight to the winners' addresses, and every step can be checked on
          the giveaway's page.
        </p>
        <Link className="button" to="/create">Create a giveaway</Link>
      </section>
      <h2>All giveaways</h2>
      {q.isPending && <Loading what="giveaways" />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data?.length === 0 && <p className="muted">No giveaways yet.</p>}
      <ul className="cards">
        {q.data
          ?.filter((c) => c.status !== Status.DRAFT)
          .map((c) => (
            <li key={c.id}>
              <Link to={`/g/${c.id}`} className="card">
                <div className="row">
                  <StatusBadge status={c.status} />
                  <span className="muted small">{modeName(c.mode)}</span>
                </div>
                <strong className="prize">{prizeText(c)}</strong>
                <span>
                  {c.k} winner{c.k === 1 ? "" : "s"}
                  {c.snapshot ? ` · ${c.snapshot.n} entrants` : ""}
                </span>
                <span className="muted small">{c.status === Status.OPEN ? `Closes ${when(c.closesAt)}` : `Closed ${when(c.closesAt)}`}</span>
              </Link>
            </li>
          ))}
      </ul>
    </>
  );
}
