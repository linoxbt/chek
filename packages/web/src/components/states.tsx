import type { ReactNode } from "react";
import { Link } from "react-router";
import { MARK_PATH } from "./brand-paths.ts";

/** Shimmering placeholder blocks. */
export function Skeleton({ h = 16, w = "100%", r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function SkeletonTiles({ n = 4 }: { n?: number }) {
  return (
    <div className="tiles stat-tiles" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div className="tile" key={i}>
          <Skeleton h={10} w="45%" />
          <Skeleton h={26} w="60%" />
          <Skeleton h={10} w="70%" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="gtable" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div className="gt-row skel-row" key={i}>
          <Skeleton h={22} w={86} r={999} />
          <Skeleton h={14} w="55%" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton h={34} w="40%" />
      <div style={{ height: 10 }} />
      <Skeleton h={14} w="60%" />
      <div style={{ height: 26 }} />
      <SkeletonTiles />
      <div style={{ height: 18 }} />
      <SkeletonRows />
    </div>
  );
}

/** Empty state: the brand glyph, a line of text and an optional action. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: { to: string; label: string } | undefined }) {
  return (
    <div className="empty">
      <svg width="44" height="44" viewBox="4 4 56 56" aria-hidden>
        <path d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <strong>{title}</strong>
      {children && <p className="dim">{children}</p>}
      {action && <Link className="btn coral small" to={action.to}>{action.label} <span aria-hidden>→</span></Link>}
    </div>
  );
}
