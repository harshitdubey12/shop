import type { Booking } from "./types";
import { normalizePhone } from "./phone";
import type { StoredRebookPayload } from "./rebookStorage";

/** Latest appointment by calendar date, then time (HH:mm). */
export function compareBookingsByVisitDesc(a: Booking, b: Booking): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;
  return b.time.localeCompare(a.time);
}

/**
 * Prefer non-cancelled rows for "last visit"; if none, fall back to full list.
 */
export function mostRecentBookingByVisit(rows: Booking[]): Booking | null {
  if (rows.length === 0) return null;
  const preferred = rows.filter((b) => b.status !== "cancelled");
  const pool = preferred.length > 0 ? preferred : rows;
  return [...pool].sort(compareBookingsByVisitDesc)[0] ?? null;
}

/** Build rebook snapshot from shop booking history (Firestore or demo list). */
export function buildRebookPayloadFromBookings(
  rows: Booking[]
): StoredRebookPayload | null {
  const last = mostRecentBookingByVisit(rows);
  if (!last) return null;
  const date =
    last.date && /^\d{4}-\d{2}-\d{2}$/.test(last.date)
      ? last.date
      : "";
  const time =
    last.time && /^\d{2}:\d{2}$/.test(last.time) ? last.time : "10:00";
  const customerPhone = normalizePhone(last.customerPhone);
  if (customerPhone.length !== 12) return null;
  const serviceId = String(last.serviceId ?? "").trim();
  if (!serviceId) return null;
  return {
    serviceId,
    time,
    customerName: String(last.customerName ?? "").trim(),
    customerPhone,
    lastVisitDate: date,
  };
}
