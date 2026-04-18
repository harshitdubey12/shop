import type { Booking, Shop, ShopStaffMember } from "./types";
import { getActiveStaffMembers } from "./shopStaff";

export type StaffPick =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "no_staff" };

/** Count active bookings per staff for a given wall clock time. */
function countsForTime(
  staff: ShopStaffMember[],
  bookings: Booking[],
  isoDate: string,
  time: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of staff) map.set(s.id, 0);
  for (const b of bookings) {
    if (b.date !== isoDate || b.time !== time) continue;
    if (b.status === "cancelled") continue;
    const aid = b.assignedBarberId ?? b.barberId;
    if (aid && map.has(aid)) {
      map.set(aid, (map.get(aid) ?? 0) + 1);
      continue;
    }
    if (!aid) {
      let h = 0;
      for (let i = 0; i < b.id.length; i++) {
        h = (h + b.id.charCodeAt(i)) | 0;
      }
      const pickIdx = Math.abs(h) % staff.length;
      const sid = staff[pickIdx]!.id;
      map.set(sid, (map.get(sid) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * Pick staff for a new booking: honor preferred when they still have capacity at this time,
 * otherwise choose the lowest current load (stable tie-break by id).
 */
export function assignStaffForSlot(
  shop: Shop | null,
  isoDate: string,
  time: string,
  existing: Booking[],
  preferredBarberId: string | null
): StaffPick {
  const staff = getActiveStaffMembers(shop);
  if (staff.length === 0) return { ok: false, reason: "no_staff" };

  const counts = countsForTime(staff, existing, isoDate, time);

  if (preferredBarberId) {
    const pref = staff.find((s) => s.id === preferredBarberId);
    if (pref) {
      const c = counts.get(pref.id) ?? 0;
      if (c < 1) return { ok: true, id: pref.id, name: pref.name };
    }
  }

  let bestId = staff[0]!.id;
  let bestScore = counts.get(bestId) ?? 0;
  for (const s of staff) {
    const sc = counts.get(s.id) ?? 0;
    if (sc < bestScore || (sc === bestScore && s.id < bestId)) {
      bestScore = sc;
      bestId = s.id;
    }
  }
  const name = staff.find((s) => s.id === bestId)?.name ?? bestId;
  return { ok: true, id: bestId, name };
}
