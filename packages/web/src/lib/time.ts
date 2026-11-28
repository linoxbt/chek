import { useEffect, useState } from "react";

/** Re-renders every `ms` milliseconds; returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, ms);
    return () => {
      clearInterval(t);
    };
  }, [ms]);
  return now;
}

/** "2d 4h", "3h 12m", "4m 09s", "now". */
export function countdown(target: number, now: number): string {
  let s = Math.max(0, Math.floor((target - now) / 1000));
  if (s === 0) return "now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or "in 3 h" for the future. */
export function relTime(t: number, now: number): string {
  const diff = now - t;
  const a = Math.abs(diff);
  const fmt = (n: number, u: string) => (diff >= 0 ? `${n} ${u} ago` : `in ${n} ${u}`);
  if (a < 60_000) return diff >= 0 ? "just now" : "in a moment";
  if (a < 3_600_000) return fmt(Math.round(a / 60_000), "min");
  if (a < 86_400_000) return fmt(Math.round(a / 3_600_000), "h");
  const d = Math.round(a / 86_400_000);
  return fmt(d, d === 1 ? "day" : "days");
}
