import type { BookingStatus } from "./types";

/** Canonical booking statuses; invalid or legacy pending map to confirmed. */
export function sanitizeBookingStatus(raw: unknown): BookingStatus {
  const s = String(raw ?? "");
  if (s === "pending") return "confirmed";
  if (
    s === "confirmed" ||
    s === "completed" ||
    s === "cancelled" ||
    s === "no_show"
  ) {
    return s;
  }
  return "confirmed";
}
