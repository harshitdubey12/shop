import type { Firestore } from "firebase/firestore";
import type { Booking, Shop } from "./types";
import { haversineKm } from "./haversine";
import { isShopLocationComplete } from "./shopGeo";
import { listShopsByCity } from "./shops";
import { listBookingsForShopDate } from "./bookings";
import { slotsForDateWithCapacity } from "./slotCapacity";
import { getActiveStaffMembers } from "./shopStaff";
import { isShopSubscriptionValid } from "./subscription";

export type NearbyShopSuggestion = {
  shop: Shop;
  distanceKm: number | null;
  nextAvailableTime: string | null;
};

function distanceOrNull(a: Shop, b: Shop): number | null {
  if (
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    return null;
  }
  if (a.lat === 0 && a.lng === 0) return null;
  if (b.lat === 0 && b.lng === 0) return null;
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}

function firstAvailableTimeForShop(
  iso: string,
  shop: Shop,
  rows: Booking[]
): string | null {
  const capacity = Math.max(1, getActiveStaffMembers(shop).length);
  const counts: Record<string, number> = {};
  for (const b of rows) {
    if (b.status === "cancelled" || b.date !== iso) continue;
    counts[b.time] = (counts[b.time] ?? 0) + 1;
  }
  const merged = slotsForDateWithCapacity(iso, counts, capacity);
  const hit = merged.find((s) => s.available);
  return hit?.time ?? null;
}

export type NearbySuggestionsResult = {
  suggestions: NearbyShopSuggestion[];
  /** True when Firestore or logic failed; UI should show a safe message. */
  failed: boolean;
};

/**
 * When current shop cannot serve a slot, suggest up to 3 other shops in the same city
 * within 5 km (or same city only when coordinates are unset), with subscription valid.
 */
export async function getNearbyBookingSuggestions(
  db: Firestore,
  current: Shop,
  isoDate: string
): Promise<NearbySuggestionsResult> {
  try {
    if (current.locationIncomplete) {
      return { suggestions: [], failed: false };
    }
    if (!isShopLocationComplete(current)) {
      return { suggestions: [], failed: false };
    }
    const peers = await listShopsByCity(db, current.city);
    const candidates: { shop: Shop; distanceKm: number | null }[] = [];

    for (const s of peers) {
      if (s.id === current.id) continue;
      if (!isShopSubscriptionValid(s)) continue;
      const d = distanceOrNull(current, s);
      if (d !== null && d > 5) continue;
      if (d === null) {
        candidates.push({ shop: s, distanceKm: null });
      } else {
        candidates.push({ shop: s, distanceKm: d });
      }
    }

    candidates.sort((a, b) => {
      const da = a.distanceKm;
      const db_ = b.distanceKm;
      if (da !== null && db_ !== null) return da - db_;
      if (da !== null) return -1;
      if (db_ !== null) return 1;
      return a.shop.name.localeCompare(b.shop.name);
    });

    const suggestions: NearbyShopSuggestion[] = [];

    for (const c of candidates) {
      if (suggestions.length >= 3) break;
      const rows = await listBookingsForShopDate(db, c.shop.id, isoDate);
      const next = firstAvailableTimeForShop(isoDate, c.shop, rows);
      if (!next) continue;
      suggestions.push({
        shop: c.shop,
        distanceKm: c.distanceKm,
        nextAvailableTime: next,
      });
    }

    return { suggestions, failed: false };
  } catch {
    return { suggestions: [], failed: true };
  }
}
