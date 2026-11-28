import { useState, type ReactNode } from "react";
import { Mode, Status, type Campaign } from "@chek/core";
import { STATUS_TEXT } from "../lib/verify-page.ts";
import { fmtSui } from "../lib/app.ts";

export function StatusBadge({ status }: { status: number }) {
  const tone = status === Status.SETTLED ? "ok" : status === Status.EXPIRED || status === Status.CANCELLED ? "idle" : status === Status.OPEN ? "live" : "warn";
  return <span className={`badge ${tone}`}><i aria-hidden />{STATUS_TEXT[status] ?? `Status ${status}`}</span>;
}

export const modeName = (mode: number) => (mode === Mode.JUDGED ? "Judged Draw" : "Random Draw");

export function prizeText(c: Campaign) {
  if (c.prizeKind === 1) return `${c.k} × ${c.prizeType?.split("::").pop() ?? "object"}`;
  const coin = c.coinType.split("::").pop();
  const total = c.status >= Status.DRAWN ? c.perWinner * BigInt(c.winners.length) + c.remainder : c.pool;
  return `${fmtSui(total)} ${coin}`;
}

export function when(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn dark small"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="muted" role="status">Loading {what}…</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <p className="error" role="alert">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
