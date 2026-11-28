import { MARK_PATH, WORDMARK_PATH, WORDMARK_WIDTH } from "./brand-paths.ts";
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

/** The C-check mark on its coral tile. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="mark">
      <rect width="64" height="64" rx="16" fill="var(--coral)" />
      <path d={MARK_PATH} fill="none" stroke="#07070a" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Lockup: mark + outlined "chek". Same geometry as the brand files: the wordmark is drawn at the tile's scale
 * (1000 font units = tile height), its x-height centred on the tile, with a gap of 0.3 × the tile height.
 */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <span className="logo" role="img" aria-label="Chek" style={{ gap: height * 0.3 }}>
      <Mark size={height} />
      {/* y 230..1226: centred on the x-height middle (y 728), tall enough for the ascenders (y 243). */}
      <svg height={height * 0.996} width={(WORDMARK_WIDTH * height) / 1000} viewBox={`0 230 ${WORDMARK_WIDTH} 996`} aria-hidden>
        <path d={WORDMARK_PATH} fill="currentColor" />
      </svg>
    </span>
  );
}
