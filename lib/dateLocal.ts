/** Local calendar date as YYYY-MM-DD (matches booking `date` field). */
export function localDateISO(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}

/**
 * Whole calendar days from an ISO date string (YYYY-MM-DD) to today (local midnight).
 * Returns null if the string is not a valid calendar date.
 */
export function calendarDaysSinceIsoDate(
  iso: string,
  now: Date = new Date()
): number | null {
  const t = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d);
  then.setHours(0, 0, 0, 0);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  return Math.round((n.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

/** Human readable "last visit" distance for customer insight copy. */
export function formatLastVisitRelative(iso: string): string | null {
  const days = calendarDaysSinceIsoDate(iso);
  if (days === null) return null;
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
