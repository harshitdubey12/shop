import { normalizePhone } from "./phone";

/** Last completed booking snapshot for "Book again" from the homepage. */
export type StoredRebookPayload = {
  serviceId: string;
  time: string;
  customerName: string;
  customerPhone: string;
  lastVisitDate: string;
};

const PAYLOAD_KEY = (shopId: string) => `barber_rebook_payload_${shopId}_v1`;
const SESSION_LAST_PHONE_KEY = (shopId: string) =>
  `barber_last_booking_phone_${shopId}_v1`;

export const HOME_REBOOK_INTENT = "barber_home_rebook_intent_v1";

/** Remember last booked phone so rebook works when localStorage is cleared but Firestore has history. */
export function rememberLastBookingPhoneForRebook(
  shopId: string,
  phone: string
): void {
  if (typeof window === "undefined") return;
  try {
    const n = normalizePhone(phone);
    if (n.length !== 12) return;
    sessionStorage.setItem(SESSION_LAST_PHONE_KEY(shopId), n);
  } catch {
    /* ignore */
  }
}

export function readLastBookingPhoneForRebook(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SESSION_LAST_PHONE_KEY(shopId));
  } catch {
    return null;
  }
}

export function saveRebookPayload(shopId: string, p: StoredRebookPayload): void {
  if (typeof window === "undefined") return;
  if (normalizePhone(p.customerPhone).length !== 12) return;
  try {
    localStorage.setItem(
      PAYLOAD_KEY(shopId),
      JSON.stringify({ ...p, customerPhone: normalizePhone(p.customerPhone) })
    );
  } catch {
    /* ignore quota */
  }
}

export function readRebookPayload(shopId: string): StoredRebookPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PAYLOAD_KEY(shopId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredRebookPayload;
  } catch {
    return null;
  }
}

export function clearRebookPayload(shopId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PAYLOAD_KEY(shopId));
  } catch {
    /* ignore */
  }
}
