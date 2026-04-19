import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  type Firestore,
  Timestamp,
} from "firebase/firestore";
import type { Shop, ShopStaffMember } from "./types";
import { normalizePhone } from "./phone";
import { runFirestoreQuery } from "./firestoreQuery";

export function mapShop(id: string, data: Record<string, unknown>): Shop {
  const expiry = data.expiryDate;
  let expiryMs = Date.now();
  if (expiry instanceof Timestamp) expiryMs = expiry.toMillis();
  else if (typeof expiry === "number") expiryMs = expiry;

  const created = data.createdAt;
  let createdMs = Date.now();
  if (created instanceof Timestamp) createdMs = created.toMillis();
  else if (typeof created === "number") createdMs = created;

  let staff: ShopStaffMember[] | undefined;
  const rawStaff = data.staff;
  if (Array.isArray(rawStaff)) {
    staff = rawStaff
      .map((x: unknown) => {
        const o = x as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          name: String(o.name ?? ""),
          active: Boolean(o.active ?? true),
        };
      })
      .filter((s) => s.id.length > 0);
    if (staff.length === 0) staff = undefined;
  }

  const latN = Number(data.lat ?? 0);
  const lngN = Number(data.lng ?? 0);
  const coordsUsable =
    Number.isFinite(latN) &&
    Number.isFinite(lngN) &&
    !(latN === 0 && lngN === 0);
  const phone = normalizePhone(
    String(data.phone ?? data.whatsappNumber ?? "")
  );
  const locationIncomplete =
    typeof data.locationIncomplete === "boolean"
      ? data.locationIncomplete
      : !coordsUsable;

  return {
    id,
    name: String(data.name ?? ""),
    ownerId: String(data.ownerId ?? ""),
    phone,
    city: String(data.city ?? ""),
    lat: Number.isFinite(latN) ? latN : 0,
    lng: Number.isFinite(lngN) ? lngN : 0,
    locationIncomplete,
    createdAt: createdMs,
    isActive: Boolean(data.isActive ?? true),
    plan: String(data.plan ?? "trial"),
    expiryDate: expiryMs,
    upiId: data.upiId ? String(data.upiId) : undefined,
    whatsappNumber: (() => {
      const raw = data.whatsappNumber;
      if (raw == null || String(raw).trim() === "") return undefined;
      const n = normalizePhone(String(raw));
      return n.length === 12 ? n : undefined;
    })(),
    totalBookings:
      typeof data.totalBookings === "number" &&
      Number.isFinite(data.totalBookings) &&
      data.totalBookings >= 0
        ? Math.floor(data.totalBookings)
        : undefined,
    staff,
    razorpayAccountId: (() => {
      const v = data.razorpayAccountId ?? data.razorpay_account_id;
      if (v == null || String(v).trim() === "") return undefined;
      const s = String(v).trim();
      return s.length > 0 ? s : undefined;
    })(),
  };
}

export async function getShop(
  db: Firestore,
  shopId: string
): Promise<Shop | null> {
  return runFirestoreQuery(async () => {
    const snap = await getDoc(doc(db, "shops", shopId));
    if (!snap.exists()) return null;
    return mapShop(snap.id, snap.data() as Record<string, unknown>);
  });
}

export async function getShopByOwner(
  db: Firestore,
  ownerId: string
): Promise<Shop | null> {
  return runFirestoreQuery(async () => {
    const q = query(
      collection(db, "shops"),
      where("ownerId", "==", ownerId)
    );
    const snaps = await getDocs(q);
    if (snaps.empty) return null;
    const d = snaps.docs[0]!;
    return mapShop(d.id, d.data() as Record<string, unknown>);
  });
}

export async function listShopsByCity(
  db: Firestore,
  city: string
): Promise<Shop[]> {
  return runFirestoreQuery(async () => {
    const trimmed = city.trim();
    const q = query(
      collection(db, "shops"),
      where("city", "==", trimmed)
    );
    const snaps = await getDocs(q);
    return snaps.docs.map((d) =>
      mapShop(d.id, d.data() as Record<string, unknown>)
    );
  });
}

export async function listAllShops(db: Firestore): Promise<Shop[]> {
  return runFirestoreQuery(async () => {
    const snaps = await getDocs(collection(db, "shops"));
    return snaps.docs.map((d) =>
      mapShop(d.id, d.data() as Record<string, unknown>)
    );
  });
}

/** WhatsApp target: dedicated number when valid 12-digit, otherwise shop phone (legacy safe). */
export function shopWhatsAppNumber(shop: Shop): string {
  const w = shop.whatsappNumber?.trim() ?? "";
  if (w.length > 0) {
    const n = normalizePhone(w);
    if (n.length === 12) return n;
  }
  return shop.phone;
}

export async function createShopDocument(
  db: Firestore,
  shopId: string,
  partial: Omit<
    Shop,
    "id" | "createdAt" | "expiryDate" | "plan" | "isActive"
  > & {
    plan?: string;
    expiryDate: Timestamp | number;
    isActive?: boolean;
  }
) {
  return runFirestoreQuery(async () => {
    const ref = doc(db, "shops", shopId);
    const hasExplicitWhatsapp =
      partial.whatsappNumber != null &&
      String(partial.whatsappNumber).trim() !== "";
    const resolvedWhatsapp = hasExplicitWhatsapp
      ? (() => {
          const n = normalizePhone(String(partial.whatsappNumber));
          return n.length === 12 ? n : partial.phone;
        })()
      : partial.phone;
    await setDoc(ref, {
      name: partial.name,
      ownerId: partial.ownerId,
      phone: partial.phone,
      city: partial.city,
      lat: partial.lat,
      lng: partial.lng,
      locationIncomplete: partial.locationIncomplete,
      createdAt: serverTimestamp(),
      isActive: partial.isActive ?? true,
      plan: partial.plan ?? "trial",
      expiryDate:
        typeof partial.expiryDate === "number"
          ? Timestamp.fromMillis(partial.expiryDate)
          : partial.expiryDate,
      ...(partial.upiId ? { upiId: partial.upiId } : {}),
      whatsappNumber: resolvedWhatsapp,
      totalBookings: 0,
      ...(partial.staff && partial.staff.length > 0
        ? { staff: partial.staff }
        : {}),
    });
  });
}

export async function updateShopFields(
  db: Firestore,
  shopId: string,
  patch: Partial<
    Pick<
      Shop,
      | "isActive"
      | "expiryDate"
      | "name"
      | "phone"
      | "city"
      | "lat"
      | "lng"
      | "locationIncomplete"
      | "upiId"
      | "whatsappNumber"
      | "plan"
    >
  >
) {
  const ref = doc(db, "shops", shopId);
  const raw: Record<string, unknown> = { ...patch };
  if (patch.expiryDate !== undefined) {
    raw.expiryDate = Timestamp.fromMillis(patch.expiryDate);
  }
  if (
    (patch.lat !== undefined || patch.lng !== undefined) &&
    patch.locationIncomplete === undefined
  ) {
    const la = patch.lat;
    const ln = patch.lng;
    if (la !== undefined && ln !== undefined) {
      const coordsUsable =
        Number.isFinite(la) &&
        Number.isFinite(ln) &&
        !(la === 0 && ln === 0);
      raw.locationIncomplete = !coordsUsable;
    }
  }
  if (patch.phone !== undefined) {
    raw.phone = normalizePhone(String(patch.phone));
  }
  if (patch.whatsappNumber !== undefined) {
    const trimmed = String(patch.whatsappNumber).trim();
    if (trimmed === "") {
      raw.whatsappNumber = deleteField();
    } else {
      const n = normalizePhone(trimmed);
      raw.whatsappNumber = n.length === 12 ? n : deleteField();
    }
  }
  return runFirestoreQuery(async () => {
    await updateDoc(ref, raw);
  });
}

export async function ensureUserProfile(
  db: Firestore,
  uid: string,
  email: string
) {
  return runFirestoreQuery(async () => {
    await setDoc(
      doc(db, "users", uid),
      {
        email,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}
