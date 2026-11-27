import { Link } from "react-router";
import { Status } from "@chek/core";
import type { VerifyReport } from "../lib/verify-page.ts";
import { explorerTx, fmtSui } from "../lib/app.ts";
import { prizeText, when } from "./bits.tsx";
import { CheckMark, CrossMark } from "./icons.tsx";

/**
 * The "overview" panel: what was locked, how the replies narrowed to winners, and the on-chain
 * record of each step. Used on the home page (latest settled giveaway) and the Verify page.
 */
export function ProofPanel({ report, link = false }: { report: VerifyReport; link?: boolean }) {
  const c = report.campaign;
  const s = c.snapshot;
  const passed = report.checks.filter((k) => k.state === "pass").length;
  const failed = report.checks.filter((k) => k.state === "fail").length;
  const bars = s
    ? [
        { label: "Replies", value: s.repliesSeen },
        { label: "Eligible", value: s.n },
        { label: "Winners", value: report.winners.length },
      ]
    : [];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const coin = c.coinType.split("::").pop();

  type Row = { what: string; value: string; href?: string | undefined; tone?: "pos" | "neutral" };
  const rows: Row[] = [{ what: "Prize locked", value: prizeText(c), tone: "neutral" }];
  if (c.openedAt) rows.push({ what: "Opened on X", value: when(c.openedAt), tone: "neutral" });
  if (s) rows.push({ what: "Snapshot sealed", value: `${s.n} entrants`, href: report.history.committedDigest && explorerTx(report.history.committedDigest), tone: "neutral" });
  if (c.status >= Status.DRAWN && c.status <= Status.SETTLED) rows.push({ what: "Winners drawn", value: `${report.winners.length} by Sui Random`, href: report.history.drawnDigest && explorerTx(report.history.drawnDigest), tone: "neutral" });
  for (const w of report.winners) {
    if (!w.payout) continue;
    rows.push({ what: `Paid @${w.entrant?.handle ?? "winner"}`, value: c.prizeKind === 0 ? `+${fmtSui(BigInt(w.payout.amount))} ${coin}` : "+1 prize", href: explorerTx(w.payout.digest), tone: "pos" });
  }

  return (
    <section className="panel overview" aria-label="Giveaway overview">
      <header className="panel-head">
        <span>{link ? <Link to={`/g/${c.id}`}>Latest verified draw</Link> : "Overview"}</span>
        <span className="muted">{s ? `Closed ${when(c.closesAt)}` : `Closes ${when(c.closesAt)}`}</span>
      </header>
      <div className="overview-grid">
        <div className="tile">
          <span className="eyebrow muted">Prize pool</span>
          <strong className="big">{prizeText(c)}</strong>
          <span className={`chip ${failed ? "bad" : "good"}`}>
            {failed ? <CrossMark /> : <CheckMark />}
            {failed ? `${failed} check${failed === 1 ? "" : "s"} failed` : `${passed} of ${report.checks.length} checks passed`}
          </span>
          {bars.length > 0 ? (
            <div className="bars" role="img" aria-label={bars.map((b) => `${b.label} ${b.value}`).join(", ")}>
              {bars.map((b, i) => (
                <div key={b.label} className="bar-col">
                  <span className="bar-val">{b.value}</span>
                  <div className={`bar b${i}`} style={{ height: `${Math.max(8, (b.value / max) * 100)}%` }} />
                  <span className="bar-label">{b.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small tile-note">The entrant count appears here once the enclave seals the snapshot after closing.</p>
          )}
        </div>
        <div className="tile">
          <span className="tile-title">On-chain record</span>
          <ul className="activity">
            {rows.map((r) => (
              <li key={r.what + r.value}>
                <span>{r.href ? <a href={r.href}>{r.what}</a> : r.what}</span>
                <span className={r.tone === "pos" ? "pos" : ""}>{r.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
