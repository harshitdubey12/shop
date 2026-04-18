import type { Firestore } from "firebase/firestore";
import { listBookingsForCustomerPhone } from "./bookings";
import { buildRebookPayloadFromBookings } from "./customerHistory";
import { isFirebaseConfigured } from "./firebase";
import { normalizePhone } from "./phone";
import {
  readLastBookingPhoneForRebook,
  readRebookPayload,
  type StoredRebookPayload,
} from "./rebookStorage";

function mergeRebookPayload(
  local: StoredRebookPayload,
  firestore: StoredRebookPayload
): StoredRebookPayload {
  const nameFs = firestore.customerName.trim();
  const nameLocal = local.customerName.trim();
  const phoneFs = normalizePhone(firestore.customerPhone);
  const phone =
    phoneFs.length === 12
      ? phoneFs
      : normalizePhone(local.customerPhone);
  const mergedServiceId =
    String(firestore.serviceId ?? "").trim() ||
    String(local.serviceId ?? "").trim();
  return {
    serviceId: mergedServiceId,
    time: firestore.time || local.time,
    customerName: nameFs || nameLocal,
    customerPhone: phone,
    lastVisitDate: firestore.lastVisitDate || local.lastVisitDate,
  };
}

/**
 * Prefer Firestore booking history; fall back to localStorage payload.
 * Uses session-stored phone when localStorage is empty so "Book again" still works.
 */
export async function resolveRebookPayloadForWizard(
  db: Firestore | null,
  shopId: string
): Promise<StoredRebookPayload | null> {
  const local = readRebookPayload(shopId);
  const sessionPhone = readLastBookingPhoneForRebook(shopId);

  const phoneCandidates: string[] = [];
  if (local?.customerPhone) {
    phoneCandidates.push(normalizePhone(local.customerPhone));
  }
  if (sessionPhone) {
    phoneCandidates.push(normalizePhone(sessionPhone));
  }
  const uniquePhones = [...new Set(phoneCandidates.filter((p) => p.length === 12))];

  if (uniquePhones.length === 0) {
    return null;
  }

  if (db && isFirebaseConfigured()) {
    for (const phone of uniquePhones) {
      const rows = await listBookingsForCustomerPhone(db, shopId, phone, {
        maxResults: 250,
      });
      if (rows.length === 0) continue;
      const fromFirestore = buildRebookPayloadFromBookings(rows);
      if (!fromFirestore) continue;
      if (local) {
        return mergeRebookPayload(local, fromFirestore);
      }
      return fromFirestore;
    }
  }

  if (local) {
    const np = normalizePhone(local.customerPhone);
    if (np.length === 12) {
      return {
        ...local,
        customerPhone: np,
      };
    }
  }

  return null;
}
