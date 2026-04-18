/** Booking price from Firestore or demo; never NaN and never negative for sums. */
export function safeBookingAmount(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}
