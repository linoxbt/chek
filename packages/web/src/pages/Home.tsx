import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status, type RulesV1 } from "@chek/core";
import { reader } from "../lib/app.ts";
import { verifyCampaign, type VerifyReport } from "../lib/verify-page.ts";
import { ErrorBox, Loading, modeName, prizeText, StatusBadge, when } from "../components/bits.tsx";
import { Console, traceRows } from "../components/Console.tsx";
import { Dot, StatusWord, Tag } from "../components/ui.tsx";
import { short } from "../lib/app.ts";

const STACK = ["Sui", "Sui Random", "Walrus", "Nautilus", "AWS Nitro", "SuiNS", "X API"];

const STEPS = [
  ["Lock the prize", "Set the prize and the rules. One signature escrows the prize on Sui and pins the rules' hash.", "$ lock 300 SUI · 3 winners"],
  ["Post on X", "Post as usual with the giveaway link. People enter by replying with a Sui address or SuiNS name.", "$ open x.com/you/status/…"],
  ["Draw and pay", "At close, the enclave seals the replies, Sui Random draws the winners and the prizes go straight to them.", "✓ paid · checks 12/12"],
] as const;

const FAQ = [
  ["Can the organizer pick their friends as winners?", "No. Winners come from Sui's on-chain randomness, drawn in a transaction nobody can predict or retry. The organizer never touches the draw."],
  ["Who decides which replies count?", "The rules, published before the giveaway opens and locked by hash. A sealed AWS Nitro enclave applies them to every reply and signs the list. Its code is public and pinned on-chain."],
  ["What if the snapshot or draw never happens?", "If no snapshot is committed within 48 hours of closing, anyone can expire the giveaway and the prize goes back to the organizer. It can't get stuck."],
  ["How do I check a result myself?", "Open the giveaway page. Your browser fetches everything from Sui and Walrus and reruns every check. Search your handle to see whether you were counted, and why."],
  ["What does the AI judge see in a Judged Draw?", "Only the reply text and the organizer's published rubric. It answers pass or fail, and winners are still drawn at random from the passes."],
  ["Why do I need a Sui address?", "Prizes are paid straight to the address in your reply. Nobody holds them for you, and there's nothing to claim."],
] as const;

function RulesCode({ rules }: { rules: RulesV1 }) {
  const lines = JSON.stringify(rules, null, 2).split("\n").slice(0, 9);
  return (
    <pre className="code" aria-label="The published rules">
      <span className="code-file mono">rules.json · hash-pinned</span>
      {lines.map((l, i) => (
        <span key={i} className="code-line">
          <span className="ln">{i + 1}</span>
          <span>{highlight(l)}</span>
        </span>
      ))}
    </pre>
  );
}

/** JSON syntax colours as React nodes (the rules come from Walrus: never build HTML from them). */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(\d+|true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) {
      out.push(<b key={m.index} className={m[2] ? "k" : "s"}>{m[1]}</b>);
      if (m[2]) out.push(m[2]);
    } else out.push(<b key={m.index} className="n">{m[3]}</b>);
    last = re.lastIndex;
  }
  out.push(line.slice(last));
  return out;
}

function Bento({ r }: { r: VerifyReport }) {
  const doc = r.doc;
  const winners = new Set(r.campaign.winners);
  return (
    <div className="bento">
      <article className="card b-wide">
        <header className="card-head"><span className="mono-label"><em>01</em> Lock</span><span className="mono-label">On-chain escrow</span></header>
        <h3>The prize is locked before anyone enters.</h3>
        <p className="dim">The prize and the rules' hash go into a Sui object when the giveaway is created. Nobody can withdraw early or change a rule.</p>
        {r.rules && <RulesCode rules={r.rules} />}
        <div className="chips mono"><span><Dot /> escrowed</span><span><Dot /> hash-pinned</span><span><Dot /> refundable</span></div>
      </article>
      <article className="card">
        <header className="card-head"><span className="mono-label">Verification status</span><span className="mono-label ok-label"><Dot /> {r.ok ? "passing" : "failing"}</span></header>
        <ul className="status-list">
          {r.checks.slice(0, 7).map((k) => (
            <li key={k.id}>
              <span>{k.title}</span>
              <StatusWord tone={k.state === "pass" ? "ok" : k.state === "fail" ? "bad" : "warn"}>{k.state}</StatusWord>
            </li>
          ))}
        </ul>
        <Link className="coral-link" to={`/g/${r.campaign.id}`}>{r.checks.length} checks · see all →</Link>
      </article>
      <article className="card">
        <header className="card-head"><span className="mono-label"><em>02</em> Seal</span><span className="mono-label">Nautilus enclave</span></header>
        <h3>Replies sealed at close</h3>
        <ol className="mini-steps">
          <li><em>01</em><div><strong>Read</strong><span className="mono-label">every reply via X API</span></div></li>
          <li><em>02</em><div><strong>Filter</strong><span className="mono-label">published rules only</span></div></li>
          <li><em>03</em><div><strong>Judge</strong><span className="mono-label">optional AI rubric</span></div></li>
          <li><em>04</em><div><strong>Sign</strong><span className="mono-label">attested enclave key</span></div></li>
        </ol>
      </article>
      <article className="card">
        <header className="card-head"><span className="mono-label"><em>03</em> Draw</span><span className="mono-label">Sui Random</span></header>
        <h3>Winners nobody chose</h3>
        <ul className="entrants">
          {doc?.entrants.slice(0, 5).map((e) => (
            <li key={e.i} className={winners.has(e.i) ? "win" : ""}>
              <Dot tone={winners.has(e.i) ? "ok" : "idle"} />
              <span>@{e.handle}</span>
              <span className="mono dim">{short(e.address)}</span>
              <span className="mono small">{winners.has(e.i) ? `#${r.campaign.winners.indexOf(e.i) + 1}` : "entrant"}</span>
            </li>
          ))}
        </ul>
        <span className="mono-label foot-note">{doc ? `${doc.entrants.length} entrants · merkle-committed` : ""}</span>
      </article>
      <article className="card">
        <header className="card-head"><span className="mono-label"><em>04</em> Trace</span><span className="mono-label">Full on-chain log</span></header>
        <h3>Every step on the record</h3>
        <ul className="log mono">
          {traceRows(r).slice(0, 6).map((t) => (
            <li key={t.what + t.ref}>
              <span className="dim">{t.ref}</span>
              <StatusWord tone={t.tone}>{t.status}</StatusWord>
              <span className="log-what">{t.what.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

export function Home() {
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const featured = list.data?.find((c) => c.status === Status.SETTLED);
  const proof = useQuery({ queryKey: ["verify", featured?.id], enabled: !!featured, queryFn: () => verifyCampaign(reader, featured!.id) });
  const live = list.data?.filter((c) => c.status === Status.OPEN).length ?? 0;
  const [open, setOpen] = useState(0);

  return (
    <>
      <section className="hero">
        <div className="halftone" aria-hidden />
        <div className="wrap hero-inner">
          <span className="chip mono"><Dot tone="bad" /> Chek on Sui · {live} giveaway{live === 1 ? "" : "s"} live</span>
          <h1>
            Giveaways with draws <span className="coral">nobody can rig</span>
          </h1>
          <p className="lede">
            Chek locks the prize on-chain, seals the replies in an attested enclave and draws winners with Sui's randomness. Anyone can
            check the result, down to the last reply.
          </p>
          <div className="actions">
            <Link className="btn coral" to="/app">Launch app <span aria-hidden>→</span></Link>
            {featured && <Link className="btn dark" to={`/g/${featured.id}`}>Verify a draw</Link>}
          </div>
        </div>
      </section>

      <section className="wrap ticker-wrap">
        <p className="mono-label center">Built on the stack underneath</p>
        <div className="ticker mono" aria-label="Built on">
          <div className="ticker-track">
            {[...STACK, ...STACK].map((s, i) => (
              <span key={i} aria-hidden={i >= STACK.length}><i className="dot bad" />{s}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap section" id="protocol">
        <Tag>The protocol</Tag>
        <h2>Four guarantees behind every draw.</h2>
        <p className="lede">The prize, the rules, the entrant list and the draw are each locked somewhere you can check, so you don't have to trust the organizer or Chek.</p>
        {proof.data ? <Bento r={proof.data} /> : <p className="dim">Loading the latest verified draw…</p>}
      </section>

      <section className="wrap section" id="how">
        <Tag>How it works</Tag>
        <h2>From post to payout in three steps.</h2>
        <p className="lede">No spreadsheet, no screen recording, no “trust me”.</p>
        <ol className="step-cards">
          {STEPS.map(([t, d, cmd], i) => (
            <li key={t} className="card">
              <span className="step-num mono">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3>
              <p className="dim">{d}</p>
              <span className="cmd mono">{cmd}</span>
            </li>
          ))}
        </ol>
      </section>

      {proof.data && (
        <section className="wrap section">
          <div className="center-head">
            <Tag>The verify page</Tag>
            <h2>One page that proves the whole draw.</h2>
            <p className="lede">Every giveaway gets one. It reads only Sui and Walrus, and your browser reruns every check.</p>
          </div>
          <Console report={proof.data} url={`chek-giveaways.netlify.app/g/${short(proof.data.campaign.id)}`} />
        </section>
      )}

      <section className="wrap section" id="giveaways">
        <Tag>Live board</Tag>
        <h2>Every giveaway, in the open.</h2>
        <Link className="coral-link" to="/giveaways">Open the full board in the app →</Link>
        {list.isPending && <Loading what="giveaways" />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data?.length === 0 && <p className="dim">No giveaways yet.</p>}
        <ul className="cards">
          {list.data
            ?.filter((c) => c.status !== Status.DRAFT)
            .slice(0, 6)
            .map((c) => (
              <li key={c.id}>
                <Link to={`/g/${c.id}`} className="card g-card">
                  <div className="row between">
                    <StatusBadge status={c.status} />
                    <span className="mono-label">{modeName(c.mode)}</span>
                  </div>
                  <strong className="g-prize">{prizeText(c)}</strong>
                  <span className="dim">
                    {c.k} winner{c.k === 1 ? "" : "s"}
                    {c.snapshot ? ` · ${c.snapshot.n} entrants` : ""}
                  </span>
                  <span className="mono small dim">{c.status === Status.OPEN ? `closes ${when(c.closesAt)}` : `closed ${when(c.closesAt)}`}</span>
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <section className="wrap section faq-wrap" id="faq">
        <div className="center-head">
          <Tag>FAQ</Tag>
          <h2>Questions entrants ask first.</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`faq-item${open === i ? " open" : ""}`}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{q}</span>
                <i aria-hidden>{open === i ? "−" : "+"}</i>
              </button>
              {open === i && <p className="dim">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="cta">
          <div className="halftone" aria-hidden />
          <h2>Run a giveaway nobody can question.</h2>
          <p className="lede">Set it up in a few minutes and lock the prize with one signature. The checks take care of the rest.</p>
          <div className="actions">
            <Link className="btn coral" to="/create">Create a giveaway <span aria-hidden>→</span></Link>
            <a className="btn dark" href="https://github.com/linoxbt/chek">Read the source</a>
          </div>
        </div>
      </section>
    </>
  );
}
