import type { Booking } from "./types";

const ANY_LABEL = "Any available";
const ASSIGNED_STAFF_LABEL = "Assigned staff";

function isGuestAnyPool(b: Booking): boolean {
  const noGuestPick =
    b.barberId == null || String(b.barberId).trim().length === 0;
  const hasAssign =
    b.assignedBarberId != null &&
    String(b.assignedBarberId).trim().length > 0;
  return noGuestPick && hasAssign;
}

/**
 * Single label for who is on the hook for the cut (assigned first, then guest choice).
 */
export function formatBookingBarberForDisplay(b: Booking): string {
  if (isGuestAnyPool(b)) return ANY_LABEL;

  const assignedName = (b.assignedBarberName ?? "").trim();
  if (assignedName) return assignedName;

  const assignedId = b.assignedBarberId;
  if (assignedId != null && String(assignedId).length > 0) {
    return ASSIGNED_STAFF_LABEL;
  }

  const choiceName = (b.barberName ?? "").trim();
  if (
    choiceName &&
    choiceName.toLowerCase() !== ANY_LABEL.toLowerCase()
  ) {
    return choiceName;
  }

  const choiceId = b.barberId;
  if (choiceId != null && String(choiceId).length > 0) {
    return ASSIGNED_STAFF_LABEL;
  }

  return ANY_LABEL;
}

/** Desk view: prefer names; assigned-without-name uses a neutral label; guest pick id-only stays a short id. */
export function formatBookingBarberForAdmin(b: Booking): string {
  if (isGuestAnyPool(b)) return ANY_LABEL;

  const assignedName = (b.assignedBarberName ?? "").trim();
  if (assignedName) return assignedName;

  const assignedId = b.assignedBarberId;
  if (assignedId != null && String(assignedId).length > 0) {
    return ASSIGNED_STAFF_LABEL;
  }

  const choiceName = (b.barberName ?? "").trim();
  if (
    choiceName &&
    choiceName.toLowerCase() !== ANY_LABEL.toLowerCase()
  ) {
    return choiceName;
  }

  const choiceId = b.barberId;
  if (choiceId != null && String(choiceId).length > 0) {
    const s = String(choiceId);
    return s.length > 22 ? `${s.slice(0, 14)}…` : s;
  }

  return ANY_LABEL;
}
