import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  Timestamp,
} from "firebase/firestore";
import type { Booking, BookingStatus, PaymentStatus } from "./types";
import {
  legacyTenDigitFromCanonical,
  normalizePhone,
} from "./phone";
import { runFirestoreQuery } from "./firestoreQuery";
import { safeBookingAmount } from "./amounts";
import { sanitizeBookingStatus } from "./bookingStatus";
import { effectiveVisitCount } from "./customerVisitStats";
import { clearShopBookingStatsCache } from "./shopBookingStats";
import { getDefaultShopId } from "./defaultShop";

const LEGACY_COL = "bookings";

/** Below this many canonical matches, also query legacy 10-digit phone (mixed Firestore data). */
const PHONE_QUERY_LEGACY_THRESHOLD = 10;

/** Serialize visit allocation per shop and phone so seeding plus transaction stays consistent. */
const visitAllocationChains = new Map<string, Promise<unknown>>();

function runVisitAllocationSerialized<T>(
  shopId: string,
  normalizedPhone: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = `${shopId}:${normalizedPhone}`;
  const prev = visitAllocationChains.get(key) ?? Promise.resolve();
  const result = prev.catch(() => undefined).then(() => fn()) as Promise<T>;
  visitAllocationChains.set(
    key,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

/** Counter doc: shops/{shopId}/customerCounters/{normalizedPhone} */
export function customerCounterRef(
  db: Firestore,
  shopId: string,
  normalizedPhone: string
) {
  return doc(db, "shops", shopId, "customerCounters", normalizedPhone);
}

export { sanitizeBookingStatus };

function bookingsCollectionRef(db: Firestore, shopId: string) {
  return collection(db, "shops", shopId, "bookings");
}

function normalizePaymentStatus(raw: unknown): PaymentStatus {
  const s = String(raw ?? "");
  if (s === "pending_payment" || s === "paid" || s === "cash") return s;
  if (s === "cash_at_shop") return "cash";
  if (s === "paid_upi") return "paid";
  if (s === "pending_verification" || s === "unpaid") return "pending_payment";
  return "pending_payment";
}

function withShopId(b: Booking, shopId: string): Booking {
  return { ...b, shopId: b.shopId ?? shopId };
}

function mapDoc(id: string, data: DocumentData): Booking {
  const legacyProof =
    (data.paymentProofUrl as string | undefined) ??
    (data.paymentScreenshotUrl as string | undefined);
  return {
    id,
    shopId: data.shopId ? String(data.shopId) : undefined,
    serviceId: String(data.serviceId ?? ""),
    serviceName: String(data.serviceName ?? ""),
    barberId: data.barberId ? String(data.barberId) : null,
    barberName: data.barberName ? String(data.barberName) : null,
    assignedBarberId:
      data.assignedBarberId != null && data.assignedBarberId !== ""
        ? String(data.assignedBarberId)
        : data.barberId
          ? String(data.barberId)
          : null,
    assignedBarberName:
      data.assignedBarberName != null && String(data.assignedBarberName).length
        ? String(data.assignedBarberName)
        : data.barberName
          ? String(data.barberName)
          : null,
    date: String(data.date ?? ""),
    time: String(data.time ?? ""),
    customerName: String(data.customerName ?? ""),
    customerPhone: normalizePhone(String(data.customerPhone ?? "")),
    status: sanitizeBookingStatus(data.status),
    paymentStatus: normalizePaymentStatus(data.paymentStatus),
    paymentProofUrl: legacyProof ? String(legacyProof) : null,
    amount: safeBookingAmount(data.amount),
    customerVisitNumber:
      typeof data.customerVisitNumber === "number" &&
      Number.isFinite(data.customerVisitNumber)
        ? data.customerVisitNumber
        : undefined,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toMillis()
        : typeof data.createdAt?.toMillis === "function"
          ? data.createdAt.toMillis()
          : Date.now(),
    countedInShopTotal:
      data.countedInShopTotal === true ? true : undefined,
  };
}

function dedupeBookingsById(rows: Booking[]): Booking[] {
  const m = new Map<string, Booking>();
  for (const b of rows) {
    m.set(b.id, b);
  }
  return [...m.values()];
}

function sortBookingsByCreatedAtDesc(rows: Booking[]): Booking[] {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

/** Cheap check whether any booking uses legacy 10-digit phone key. */
async function legacyPhoneHasAnyBooking(
  db: Firestore,
  shopId: string,
  leg: string
): Promise<boolean> {
  const ref = bookingsCollectionRef(db, shopId);
  const probe = await getDocs(
    query(ref, where("customerPhone", "==", leg), limit(1))
  );
  return !probe.empty;
}

/**
 * Canonical query first; legacy 10-digit when sparse, or when dense but legacy rows exist.
 */
async function listBookingsForSeedPrimaryThenLegacy(
  db: Firestore,
  shopId: string,
  canonical12: string
): Promise<Booking[]> {
  if (canonical12.length !== 12) return [];
  const ref = bookingsCollectionRef(db, shopId);
  const primary = await getDocs(
    query(ref, where("customerPhone", "==", canonical12))
  );
  const rows = primary.docs.map((d) =>
    withShopId(mapDoc(d.id, d.data()), shopId)
  );
  const leg = legacyTenDigitFromCanonical(canonical12);
  if (!leg) {
    return dedupeBookingsById(rows);
  }

  let fetchLegacyFull = false;
  if (primary.size < PHONE_QUERY_LEGACY_THRESHOLD) {
    fetchLegacyFull = true;
  } else if (await legacyPhoneHasAnyBooking(db, shopId, leg)) {
    fetchLegacyFull = true;
  }

  if (!fetchLegacyFull) {
    return dedupeBookingsById(rows);
  }

  const fb = await getDocs(query(ref, where("customerPhone", "==", leg)));
  const legacyRows = fb.docs.map((d) =>
    withShopId(mapDoc(d.id, d.data()), shopId)
  );
  return dedupeBookingsById([...rows, ...legacyRows]);
}

async function runVisitAllocationTransaction(
  db: Firestore,
  shopId: string,
  base: Record<string, unknown>,
  normalizedPhone: string,
  counterRef: DocumentReference,
  bookingRef: DocumentReference
): Promise<void> {
  const counterSnap0 = await getDoc(counterRef);
  const seedBookings = counterSnap0.exists()
    ? null
    : await listBookingsForSeedPrimaryThenLegacy(db, shopId, normalizedPhone);

  await runTransaction(db, async (transaction) => {
    const cs = await transaction.get(counterRef);
    let next: number;
    if (cs.exists()) {
      const last = Number(cs.data()?.lastVisitNumber ?? 0);
      next = last + 1;
      transaction.update(counterRef, { lastVisitNumber: increment(1) });
    } else {
      next = seedBookings
        ? Math.max(effectiveVisitCount(seedBookings) + 1, 1)
        : 1;
      transaction.set(counterRef, { lastVisitNumber: next });
    }
    transaction.set(bookingRef, {
      ...base,
      customerVisitNumber: next,
      createdAt: serverTimestamp(),
    });
  });
}

async function createBookingVisitAllocationFallback(
  db: Firestore,
  shopId: string,
  base: Record<string, unknown>,
  normalizedPhone: string
): Promise<string> {
  const counterRef = customerCounterRef(db, shopId, normalizedPhone);
  const bookingRef = doc(bookingsCollectionRef(db, shopId));
  const seedList = await listBookingsForSeedPrimaryThenLegacy(
    db,
    shopId,
    normalizedPhone
  );
  const snap = await getDoc(counterRef);
  let next: number;
  if (snap.exists()) {
    next = Number(snap.data()?.lastVisitNumber ?? 0) + 1;
  } else {
    next = Math.max(effectiveVisitCount(seedList) + 1, 1);
  }
  const batch = writeBatch(db);
  batch.set(bookingRef, {
    ...base,
    customerVisitNumber: next,
    createdAt: serverTimestamp(),
  });
  batch.set(counterRef, { lastVisitNumber: next }, { merge: true });
  await batch.commit();
  return bookingRef.id;
}

async function createBookingWithVisitCounter(
  db: Firestore,
  shopId: string,
  base: Record<string, unknown>,
  normalizedPhone: string
): Promise<string> {
  const counterRef = customerCounterRef(db, shopId, normalizedPhone);
  const bookingRef = doc(bookingsCollectionRef(db, shopId));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await runVisitAllocationTransaction(
        db,
        shopId,
        base,
        normalizedPhone,
        counterRef,
        bookingRef
      );
      return bookingRef.id;
    } catch {
      /* retry once, then fallback */
    }
  }
  return createBookingVisitAllocationFallback(
    db,
    shopId,
    base,
    normalizedPhone
  );
}

/**
 * Idempotent shop total: increment once per booking via countedInShopTotal flag.
 * Best-effort; booking creation must never depend on this.
 * @param options.skipReadPrecheck When true, skip getDoc before the transaction (e.g. booking just created in this flow).
 */
function bumpShopTotalBookingsAfterCreate(
  db: Firestore,
  shopId: string,
  bookingId: string,
  options?: { skipReadPrecheck?: boolean }
): void {
  void (async () => {
    try {
      const bookingRef = doc(db, "shops", shopId, "bookings", bookingId);
      const shopRef = doc(db, "shops", shopId);
      if (!options?.skipReadPrecheck) {
        const pre = await getDoc(bookingRef);
        if (pre.exists() && pre.data()?.countedInShopTotal === true) {
          return;
        }
      }
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(bookingRef);
        if (!snap.exists()) return;
        if (snap.data()?.countedInShopTotal === true) return;
        transaction.update(shopRef, { totalBookings: increment(1) });
        transaction.update(bookingRef, { countedInShopTotal: true });
      });
      clearShopBookingStatsCache(shopId);
    } catch {
      /* ignore */
    }
  })();
}

export async function createBooking(
  db: Firestore,
  shopId: string,
  payload: Omit<
    Booking,
    "id" | "createdAt" | "shopId" | "customerVisitNumber"
  >
): Promise<string> {
  return runFirestoreQuery(async () => {
    const status = sanitizeBookingStatus(payload.status);
    const customerPhone = normalizePhone(payload.customerPhone);
    const amount = safeBookingAmount(payload.amount);
    const base: Record<string, unknown> = {
      ...payload,
      status,
      customerPhone,
      amount,
      shopId,
      paymentProofUrl: payload.paymentProofUrl ?? null,
    };
    if (customerPhone.length !== 12) {
      const ref = await addDoc(bookingsCollectionRef(db, shopId), {
        ...base,
        createdAt: serverTimestamp(),
      });
      bumpShopTotalBookingsAfterCreate(db, shopId, ref.id, {
        skipReadPrecheck: true,
      });
      return ref.id;
    }
    const id = await runVisitAllocationSerialized(shopId, customerPhone, () =>
      createBookingWithVisitCounter(db, shopId, base, customerPhone)
    );
    bumpShopTotalBookingsAfterCreate(db, shopId, id, {
      skipReadPrecheck: true,
    });
    return id;
  });
}

/** Load booking: nested path when shopId is known; otherwise legacy top level document. */
export async function getBooking(
  db: Firestore,
  id: string,
  shopId?: string | null
): Promise<Booking | null> {
  return runFirestoreQuery(async () => {
    if (shopId) {
      const snap = await getDoc(doc(db, "shops", shopId, "bookings", id));
      if (!snap.exists()) return null;
      return withShopId(mapDoc(snap.id, snap.data()), shopId);
    }
    const legacy = await getDoc(doc(db, LEGACY_COL, id));
    if (legacy.exists()) return mapDoc(legacy.id, legacy.data());
    return null;
  });
}

/**
 * Load a booking for payment or deep links: uses explicit shop when provided,
 * then nested `shops/{defaultShopId}/bookings/{id}`, then legacy root `bookings/{id}`.
 */
export async function getBookingFlexible(
  db: Firestore,
  id: string,
  shopIdFromQuery?: string | null
): Promise<Booking | null> {
  if (shopIdFromQuery) {
    return getBooking(db, id, shopIdFromQuery);
  }
  const nested = await getBooking(db, id, getDefaultShopId());
  if (nested) return nested;
  return getBooking(db, id, null);
}

/** Legacy admin: list root bookings collection. */
export async function listBookingsLegacy(db: Firestore): Promise<Booking[]> {
  return runFirestoreQuery(async () => {
    const q = query(collection(db, LEGACY_COL), orderBy("createdAt", "desc"));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => mapDoc(d.id, d.data()));
  });
}

export async function listBookingsForShop(
  db: Firestore,
  shopId: string
): Promise<Booking[]> {
  return runFirestoreQuery(async () => {
    const q = query(
      bookingsCollectionRef(db, shopId),
      orderBy("createdAt", "desc")
    );
    const snaps = await getDocs(q);
    return snaps.docs.map((d) =>
      withShopId(mapDoc(d.id, d.data()), shopId)
    );
  });
}

/** Bookings for one day at a shop (for slot occupancy). */
export async function listBookingsForShopDate(
  db: Firestore,
  shopId: string,
  isoDate: string
): Promise<Booking[]> {
  return runFirestoreQuery(async () => {
    const q = query(
      bookingsCollectionRef(db, shopId),
      where("date", "==", isoDate)
    );
    const snaps = await getDocs(q);
    return snaps.docs.map((d) =>
      withShopId(mapDoc(d.id, d.data()), shopId)
    );
  });
}

/** Recent bookings for a normalized phone (matches legacy stored forms). Newest first. */
export async function listBookingsForCustomerPhone(
  db: Firestore,
  shopId: string,
  phoneDigits: string,
  options?: { maxResults?: number }
): Promise<Booking[]> {
  const canonical = normalizePhone(phoneDigits);
  if (canonical.length !== 12) return [];
  const maxResults = Math.min(Math.max(options?.maxResults ?? 50, 1), 50);
  return runFirestoreQuery(async () => {
    const ref = bookingsCollectionRef(db, shopId);
    const leg = legacyTenDigitFromCanonical(canonical);

    const qPrimary = query(
      ref,
      where("customerPhone", "==", canonical),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );
    const primarySnap = await getDocs(qPrimary);
    let rows = primarySnap.docs.map((d) =>
      withShopId(mapDoc(d.id, d.data()), shopId)
    );

    if (leg) {
      let needLegacyFull = false;
      if (primarySnap.size < PHONE_QUERY_LEGACY_THRESHOLD) {
        needLegacyFull = true;
      } else if (await legacyPhoneHasAnyBooking(db, shopId, leg)) {
        needLegacyFull = true;
      }

      if (needLegacyFull) {
        const qLegacy = query(
          ref,
          where("customerPhone", "==", leg),
          orderBy("createdAt", "desc"),
          limit(maxResults)
        );
        const legacySnap = await getDocs(qLegacy);
        const legacyRows = legacySnap.docs.map((d) =>
          withShopId(mapDoc(d.id, d.data()), shopId)
        );
        rows = sortBookingsByCreatedAtDesc(
          dedupeBookingsById([...rows, ...legacyRows])
        ).slice(0, maxResults);
      }
    }

    return rows;
  });
}

/** Total bookings for this phone at the shop (12-digit count plus legacy when sparse). */
export async function countBookingsForCustomerPhone(
  db: Firestore,
  shopId: string,
  phoneDigits: string
): Promise<number> {
  const canonical = normalizePhone(phoneDigits);
  if (canonical.length !== 12) return 0;
  return runFirestoreQuery(async () => {
    const ref = bookingsCollectionRef(db, shopId);
    const q12 = query(ref, where("customerPhone", "==", canonical));
    const c12 = await getCountFromServer(q12);
    const n12 = c12.data().count;
    const leg = legacyTenDigitFromCanonical(canonical);
    if (!leg) {
      return n12;
    }

    let needLegacyCount = false;
    if (n12 < PHONE_QUERY_LEGACY_THRESHOLD) {
      needLegacyCount = true;
    } else if (await legacyPhoneHasAnyBooking(db, shopId, leg)) {
      needLegacyCount = true;
    }

    if (!needLegacyCount) {
      return n12;
    }

    const q10 = query(ref, where("customerPhone", "==", leg));
    const c10 = await getCountFromServer(q10);
    return n12 + c10.data().count;
  });
}

export async function updateBookingStatus(
  db: Firestore,
  shopId: string | null,
  id: string,
  status: BookingStatus
) {
  return runFirestoreQuery(async () => {
    const next = sanitizeBookingStatus(status);
    if (shopId) {
      await updateDoc(doc(db, "shops", shopId, "bookings", id), {
        status: next,
      });
    } else {
      await updateDoc(doc(db, LEGACY_COL, id), { status: next });
    }
  });
}

export async function updatePaymentStatus(
  db: Firestore,
  shopId: string | null,
  id: string,
  paymentStatus: PaymentStatus,
  paymentProofUrl?: string | null
) {
  return runFirestoreQuery(async () => {
    const patch: Record<string, unknown> = { paymentStatus };
    if (paymentProofUrl !== undefined) {
      patch.paymentProofUrl = paymentProofUrl;
    }
    if (shopId) {
      await updateDoc(doc(db, "shops", shopId, "bookings", id), patch);
    } else {
      await updateDoc(doc(db, LEGACY_COL, id), patch);
    }
  });
}

export async function deleteBooking(
  db: Firestore,
  shopId: string | null,
  id: string
) {
  return runFirestoreQuery(async () => {
    if (shopId) {
      const bookingRef = doc(db, "shops", shopId, "bookings", id);
      const shopRef = doc(db, "shops", shopId);
      await runTransaction(db, async (transaction) => {
        const bSnap = await transaction.get(bookingRef);
        if (!bSnap.exists()) {
          return;
        }
        const counted = bSnap.data()?.countedInShopTotal === true;
        if (counted) {
          const sSnap = await transaction.get(shopRef);
          const t = sSnap.data()?.totalBookings;
          const cur =
            typeof t === "number" && Number.isFinite(t) ? Math.floor(t) : 0;
          if (cur > 0) {
            transaction.update(shopRef, { totalBookings: increment(-1) });
          }
        }
        transaction.delete(bookingRef);
      });
      clearShopBookingStatsCache(shopId);
    } else {
      await deleteDoc(doc(db, LEGACY_COL, id));
    }
  });
}
