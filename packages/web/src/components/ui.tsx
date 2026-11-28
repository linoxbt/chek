import type { ReactNode } from "react";

/** Section tag: coral spark + mono uppercase label. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="tag">
      <i aria-hidden>✦</i>
      {children}
    </span>
  );
}

export type Tone = "ok" | "warn" | "bad" | "idle";
export function Dot({ tone = "ok" }: { tone?: Tone }) {
  return <i className={`dot ${tone}`} aria-hidden />;
}

/** Mono status word, coloured like a log line. */
export function StatusWord({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`sw ${tone}`}>{children}</span>;
}

export function Logo() {
  return (
    <span className="logo">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--coral)" />
        <path d="m9.5 16.5 4.5 4.5 8.5-10" fill="none" stroke="#07070a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Chek
    </span>
  );
}
