import type { Booking } from "./types";

/** Highest stored visit index among bookings (0 when none have the field). */
export function maxCustomerVisitNumber(bookings: Booking[]): number {
  let m = 0;
  for (const b of bookings) {
    const v = b.customerVisitNumber;
    if (typeof v === "number" && Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/**
 * Stable visit count for a set of bookings for one phone: max of stored
 * customerVisitNumber and legacy row count (handles old rows without the field).
 */
export function effectiveVisitCount(bookings: Booking[]): number {
  if (bookings.length === 0) return 0;
  return Math.max(maxCustomerVisitNumber(bookings), bookings.length);
}
