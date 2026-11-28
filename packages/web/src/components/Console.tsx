import { Link } from "react-router";
import { Status } from "@chek/core";
import type { VerifyReport } from "../lib/verify-page.ts";
import { explorerTx, fmtSui, short } from "../lib/app.ts";
import { prizeText, when } from "./bits.tsx";
import { Dot, StatusWord, type Tone } from "./ui.tsx";

export interface TraceRow {
  ref: string;
  href?: string | undefined;
  what: string;
  value: string;
  tone: Tone;
  status: string;
}

/** The on-chain record of a giveaway as log lines: what happened, the transaction, and its state. */
export function traceRows(r: VerifyReport): TraceRow[] {
  const c = r.campaign;
  const s = c.snapshot;
  const coin = c.coinType.split("::").pop();
  const rows: TraceRow[] = [{ ref: short(c.id), what: "Prize locked", value: prizeText(c), tone: "ok", status: "escrowed" }];
  if (c.openedAt) rows.push({ ref: `post ${c.postId.slice(-6)}`, what: "Opened on X", value: when(c.openedAt), tone: "ok", status: "open" });
  if (s) {
    const d = r.history.committedDigest;
    rows.push({ ref: d ? short(d) : "—", href: d && explorerTx(d), what: "Snapshot sealed", value: `${s.n} of ${s.repliesSeen} replies`, tone: "ok", status: "signed" });
  }
  if (c.status >= Status.DRAWN && c.status <= Status.SETTLED) {
    const d = r.history.drawnDigest;
    rows.push({ ref: d ? short(d) : "—", href: d && explorerTx(d), what: "Winners drawn", value: `${r.winners.length} by Sui Random`, tone: "ok", status: "random" });
  }
  for (const w of r.winners) {
    if (w.payout) rows.push({ ref: short(w.payout.digest), href: explorerTx(w.payout.digest), what: `Paid @${w.entrant?.handle ?? "winner"}`, value: c.prizeKind === 0 ? `+${fmtSui(BigInt(w.payout.amount))} ${coin}` : "+1 prize", tone: "ok", status: "confirmed" });
    else rows.push({ ref: "—", what: `Pay @${w.entrant?.handle ?? "winner"}`, value: "queued", tone: "warn", status: "pending" });
  }
  if (c.status === Status.EXPIRED) rows.push({ ref: "—", what: "Expired", value: "refunded to organizer", tone: "warn", status: "refunded" });
  if (c.status === Status.CANCELLED) rows.push({ ref: "—", what: "Cancelled", value: "refunded to organizer", tone: "idle", status: "cancelled" });
  return rows;
}

function Funnel({ points }: { points: { label: string; value: number }[] }) {
  const w = 600;
  const h = 150;
  const max = Math.max(1, ...points.map((p) => p.value));
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys = points.map((p) => h - 14 - (p.value / max) * (h - 34));
  let d = `M0 ${ys[0]}`;
  for (let i = 1; i < points.length; i++) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    d += ` C${mx} ${ys[i - 1]} ${mx} ${ys[i]} ${xs[i]} ${ys[i]}`;
  }
  return (
    <svg className="funnel" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={points.map((p) => `${p.label} ${p.value}`).join(", ")}>
      <defs>
        <linearGradient id="fg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--coral)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--coral)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#fg)" />
      <path d={d} fill="none" stroke="var(--coral)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Console-style overview of one giveaway, framed like an app window. */
export function Console({ report, chrome = true, url }: { report: VerifyReport; chrome?: boolean; url?: string }) {
  const c = report.campaign;
  const s = c.snapshot;
  const passed = report.checks.filter((k) => k.state === "pass").length;
  const failed = report.checks.filter((k) => k.state === "fail").length;
  const tiles = [
    { k: "Prize pool", v: prizeText(c), sub: `${c.k} winner${c.k === 1 ? "" : "s"}` },
    { k: "Replies", v: s ? String(s.repliesSeen) : "—", sub: s ? "read by the enclave" : "after close" },
    { k: "Eligible", v: s ? String(s.n) : "—", sub: s ? "met the rules" : "after close" },
    { k: "Checks", v: `${passed}/${report.checks.length}`, sub: failed ? `${failed} failed` : "passing", tone: failed ? "bad" : "ok" },
  ];
  const rows = traceRows(report);
  return (
    <div className={`console${chrome ? " framed" : ""}`}>
      {chrome && (
        <div className="chrome">
          <span className="lights" aria-hidden><i /><i /><i /></span>
          <span className="url">{url ?? `chek/g/${short(c.id)}`}</span>
        </div>
      )}
      <div className="console-body">
        <div className="console-head">
          <strong>Overview</strong>
          <span className="mono dim">{s ? `closed ${when(c.closesAt)}` : `closes ${when(c.closesAt)}`}</span>
          <span className={`pill-status ${failed ? "bad" : "ok"}`}>
            <Dot tone={failed ? "bad" : "ok"} />
            {failed ? "Check failed" : passed === report.checks.length ? "All checks passed" : "Checks running"}
          </span>
        </div>
        <div className="tiles">
          {tiles.map((t) => (
            <div className="tile" key={t.k}>
              <span className="mono-label">{t.k}</span>
              <strong className="tile-v">{t.v}</strong>
              <span className={`mono small ${t.tone === "bad" ? "bad" : t.tone === "ok" ? "ok" : "dim"}`}>{t.sub}</span>
            </div>
          ))}
        </div>
        {s && (
          <div className="card-inner">
            <div className="row between">
              <span>Replies → eligible → winners</span>
              <span className="mono dim small">{s.repliesSeen} → {s.n} → {report.winners.length}</span>
            </div>
            <Funnel points={[{ label: "Replies", value: s.repliesSeen }, { label: "Eligible", value: s.n }, { label: "Winners", value: report.winners.length }]} />
          </div>
        )}
        <div className="card-inner">
          <div className="row between">
            <span>On-chain trace</span>
            <span className="mono small ok"><Dot tone="ok" /> live</span>
          </div>
          <ul className="trace">
            {rows.map((r) => (
              <li key={r.what + r.ref}>
                <span className="mono dim ref">{r.href ? <a href={r.href}>{r.ref}</a> : r.ref}</span>
                <span className="what">{r.what}</span>
                <span className="val">{r.value}</span>
                <StatusWord tone={r.tone}>{r.status}</StatusWord>
              </li>
            ))}
          </ul>
        </div>
        {chrome && (
          <Link className="console-link mono" to={`/g/${c.id}`}>Open the full verification →</Link>
        )}
      </div>
    </div>
  );
}
