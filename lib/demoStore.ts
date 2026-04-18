import type { Booking } from "./types";
import { safeBookingAmount } from "./amounts";
import { sanitizeBookingStatus } from "./bookingStatus";
import { normalizePhone } from "./phone";

function storageKey(shopId: string) {
  return `velve_demo_bookings_${shopId}_v2`;
}

function normalizeBookingRow(b: Booking, shopId: string): Booking {
  return {
    ...b,
    customerPhone: normalizePhone(b.customerPhone),
    status: sanitizeBookingStatus(b.status),
    amount: safeBookingAmount(b.amount),
    shopId: b.shopId ?? shopId,
  };
}

function readAll(shopId: string): Booking[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(shopId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Booking[];
    return parsed.map((b) => normalizeBookingRow(b, shopId));
  } catch {
    return [];
  }
}

function writeAll(shopId: string, list: Booking[]) {
  localStorage.setItem(storageKey(shopId), JSON.stringify(list));
}

export function demoSaveBooking(shopId: string, booking: Booking) {
  const clean = normalizeBookingRow(booking, shopId);
  const list = readAll(shopId).filter((b) => b.id !== clean.id);
  list.unshift(clean);
  writeAll(shopId, list);
}

export function demoGetBooking(shopId: string, id: string): Booking | null {
  return readAll(shopId).find((b) => b.id === id) ?? null;
}

export function demoListBookings(shopId: string): Booking[] {
  return readAll(shopId);
}

export function demoUpdateBooking(
  shopId: string,
  id: string,
  patch: Partial<Booking>
) {
  const list = readAll(shopId);
  const next = list.map((b) =>
    b.id === id ? normalizeBookingRow({ ...b, ...patch }, shopId) : b
  );
  writeAll(shopId, next);
}

export function demoDeleteBooking(shopId: string, id: string) {
  writeAll(
    shopId,
    readAll(shopId).filter((b) => b.id !== id)
  );
}
