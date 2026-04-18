import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  limit,
  type Firestore,
} from "firebase/firestore";
import { runFirestoreQuery } from "./firestoreQuery";

export type ShopBookingStats = {
  /** null when count and list fallback both failed (show em dash in UI). */
  total: number | null;
  lastBookingMillis: number | null;
};

function toMillis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as Timestamp).toMillis();
  }
  return null;
}

/** Clear session cache so the next fetch per shop is fresh (e.g. after admin actions). */
export function clearShopBookingStatsCache(shopId?: string): void {
  if (shopId) {
    sessionCache.delete(shopId);
    return;
  }
  sessionCache.clear();
}

const sessionCache = new Map<string, ShopBookingStats>();
const inflight = new Map<string, Promise<ShopBookingStats>>();

async function fetchShopBookingStatsOnce(
  db: Firestore,
  shopId: string
): Promise<ShopBookingStats> {
  return runFirestoreQuery(async () => {
    const bookingsRef = collection(db, "shops", shopId, "bookings");
    const shopRef = doc(db, "shops", shopId);

    const shopSnap = await getDoc(shopRef);
    const shopData = shopSnap.data() as Record<string, unknown> | undefined;
    const stored = shopData?.totalBookings;

    let total: number | null = null;

    if (
      typeof stored === "number" &&
      Number.isFinite(stored) &&
      stored >= 0
    ) {
      total = Math.floor(stored);
    } else {
      try {
        const c = await getCountFromServer(query(bookingsRef));
        total = c.data().count;
        try {
          await updateDoc(shopRef, { totalBookings: total });
        } catch {
          /* backfill is best-effort */
        }
      } catch {
        total = null;
      }
    }

    let lastBookingMillis: number | null = null;
    try {
      const q = query(bookingsRef, orderBy("createdAt", "desc"), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const data = snap.docs[0]!.data() as Record<string, unknown>;
        lastBookingMillis = toMillis(data.createdAt);
      }
    } catch {
      lastBookingMillis = null;
    }

    return { total, lastBookingMillis };
  });
}

/**
 * Total bookings and latest booking time for a shop.
 * Uses a small session cache and in-flight dedupe per shopId to avoid redundant work.
 */
export async function getShopBookingStats(
  db: Firestore,
  shopId: string
): Promise<ShopBookingStats> {
  const cached = sessionCache.get(shopId);
  if (cached) {
    return { total: cached.total, lastBookingMillis: cached.lastBookingMillis };
  }

  const pending = inflight.get(shopId);
  if (pending) return pending;

  const task = fetchShopBookingStatsOnce(db, shopId)
    .then((result) => {
      sessionCache.set(shopId, result);
      return result;
    })
    .finally(() => {
      inflight.delete(shopId);
    });

  inflight.set(shopId, task);
  return task;
}
