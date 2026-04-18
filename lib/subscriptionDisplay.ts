/**
 * Calendar day math and display helpers for subscription expiry (owner + admin UI).
 */

export function calendarDaysBetween(fromMs: number, toMs: number): number {
  const a = new Date(fromMs);
  a.setHours(0, 0, 0, 0);
  const b = new Date(toMs);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** Days from today until expiry (local calendar days). Negative if already expired. */
export function daysRemainingUntilExpiry(expiryMs: number, nowMs: number = Date.now()): number {
  return calendarDaysBetween(nowMs, expiryMs);
}

export function daysSinceMillis(ts: number | null | undefined, nowMs: number = Date.now()): number | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  return calendarDaysBetween(ts, nowMs);
}

export type ExpiryTone = "ok" | "warning" | "error";

export function getExpiryTone(daysRemaining: number | null): ExpiryTone {
  if (daysRemaining == null || !Number.isFinite(daysRemaining)) return "ok";
  if (daysRemaining < 0) return "error";
  if (daysRemaining < 3) return "warning";
  return "ok";
}

export function expiryToneClass(tone: ExpiryTone): string {
  if (tone === "error") return "text-red-400";
  if (tone === "warning") return "text-amber-400";
  return "text-white/70";
}
