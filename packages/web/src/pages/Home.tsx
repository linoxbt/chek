import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status } from "@chek/core";
import { reader } from "../lib/app.ts";
import { verifyCampaign } from "../lib/verify-page.ts";
import { ErrorBox, Loading, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";
import { ProofPanel } from "../components/ProofPanel.tsx";
import { ArrowUpRight, DiceIcon, LockIcon, SealIcon } from "../components/icons.tsx";

const STEPS = [
  ["Lock the prize", "The prize goes into the giveaway's on-chain escrow before anyone can enter. Nobody, including you, can take it back while it runs."],
  ["Post on X", "Post as usual with the giveaway's link. Entrants reply with a Sui address or SuiNS name."],
  ["Seal the replies", "At close, an attested enclave reads every reply, applies your published rules and signs the entrant list."],
  ["Draw and pay", "Sui's on-chain randomness picks the winners. Prizes go straight to their addresses, and anyone can check every step."],
] as const;

export function Home() {
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const featured = list.data?.find((c) => c.status === Status.SETTLED);
  const proof = useQuery({ queryKey: ["verify", featured?.id], enabled: !!featured, queryFn: () => verifyCampaign(reader, featured!.id) });

  return (
    <>
      <section className="hero wrap">
        <p className="eyebrow">Provably fair giveaways on Sui</p>
        <h1>Giveaways anyone can check.</h1>
        <p className="lede">
          Lock the prize, post on X, and let the chain pick the winners. Every reply, rule and payout is on the record, so nobody has to
          take your word for it.
        </p>
        <div className="actions">
          <Link className="pill lime" to="/create">Create a giveaway <ArrowUpRight /></Link>
          {featured ? <Link className="pill outline" to={`/g/${featured.id}`}>See a verified draw</Link> : <a className="pill outline" href="#giveaways">Browse giveaways</a>}
        </div>
        {proof.data && <ProofPanel report={proof.data} link />}
      </section>

      <section className="wrap section">
        <p className="eyebrow">One post. Every step on-chain.</p>
        <h2>Everything a giveaway needs to be trusted.</h2>
        <div className="features">
          <article className="feature">
            <span className="ficon"><LockIcon /></span>
            <h3>Prize locked first</h3>
            <p>Escrowed in a Sui object before entries open. If the draw never happens, anyone can send it back to the organizer.</p>
          </article>
          <article className="feature">
            <span className="ficon"><SealIcon /></span>
            <h3>Replies sealed in an enclave</h3>
            <p>An AWS Nitro enclave takes the snapshot and signs it. Its code is public and pinned on-chain, so nobody can edit the list.</p>
          </article>
          <article className="feature">
            <span className="ficon"><DiceIcon /></span>
            <h3>Winners by Sui Random</h3>
            <p>The draw uses Sui's on-chain randomness, which no one can predict or replay. Not the organizer, not Chek.</p>
          </article>
        </div>
      </section>

      <section className="wrap section split">
        <div>
          <p className="eyebrow">Built for proof</p>
          <h2>Less trust needed. More proof.</h2>
          <p className="muted">
            Screenshots and spreadsheet picks ask entrants to trust the organizer. On Chek, each step leaves a record on Sui or Walrus,
            and the giveaway page checks it in your browser.
          </p>
        </div>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap section" id="giveaways">
        <p className="eyebrow">Live and settled</p>
        <h2>All giveaways</h2>
        {list.isPending && <Loading what="giveaways" />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data?.length === 0 && <p className="muted">No giveaways yet.</p>}
        <ul className="cards">
          {list.data
            ?.filter((c) => c.status !== Status.DRAFT)
            .map((c) => (
              <li key={c.id}>
                <Link to={`/g/${c.id}`} className="card">
                  <div className="row between">
                    <StatusBadge status={c.status} />
                    <span className="muted small">{modeName(c.mode)}</span>
                  </div>
                  <strong className="card-prize">{prizeText(c)}</strong>
                  <span className="muted">
                    {c.k} winner{c.k === 1 ? "" : "s"}
                    {c.snapshot ? ` · ${c.snapshot.n} entrants` : ""}
                  </span>
                  <span className="muted small">{c.status === Status.OPEN ? `Closes ${when(c.closesAt)}` : `Closed ${when(c.closesAt)}`}</span>
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <section className="cta">
        <div className="wrap">
          <p className="eyebrow dark">Ready to give away?</p>
          <h2>Run a giveaway nobody can question.</h2>
          <p>A few minutes to set up. One wallet signature to lock the prize.</p>
          <Link className="pill ink" to="/create">Create a giveaway <ArrowUpRight /></Link>
        </div>
      </section>
    </>
  );
}
