import type { Firestore } from "firebase/firestore";
import { getDoc } from "firebase/firestore";
import type { Booking, ShopCustomer } from "./types";
import { mostRecentBookingByVisit } from "./customerHistory";
import { normalizePhone } from "./phone";
import { customerCounterRef, listBookingsForCustomerPhone } from "./bookings";
import { effectiveVisitCount } from "./customerVisitStats";
import { demoListBookings } from "./demoStore";

const DEMO_KEY = (shopId: string) => `velve_demo_customers_${shopId}_v1`;

function demoRead(shopId: string): Record<string, ShopCustomer> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DEMO_KEY(shopId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ShopCustomer>;
  } catch {
    return {};
  }
}

function demoWrite(shopId: string, data: Record<string, ShopCustomer>) {
  localStorage.setItem(DEMO_KEY(shopId), JSON.stringify(data));
}

export type ReturningCustomerHint = {
  visitCount: number;
  lastServiceId: string;
  lastServiceName: string;
  lastVisitDate: string;
  preferredTime: string;
  lastCustomerName: string;
  /** More than one distinct name on file for this phone at this shop. */
  mayShareNumber: boolean;
};

function distinctNameCountFromBookings(rows: Booking[]): number {
  return new Set(
    rows
      .map((b) => b.customerName.trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

/** Visit history from stored bookings (Firebase) or demo profile. */
export async function getReturningCustomerHint(
  db: Firestore | null,
  shopId: string,
  phone: string
): Promise<ReturningCustomerHint | null> {
  try {
    const key = normalizePhone(phone);
    if (key.length !== 12) return null;
    if (db) {
      let rows: Booking[];
      try {
        rows = await listBookingsForCustomerPhone(db, shopId, phone, {
          maxResults: 50,
        });
      } catch {
        return null;
      }
      let visitCount = effectiveVisitCount(rows);
      try {
        const counterSnap = await getDoc(customerCounterRef(db, shopId, key));
        const lastN = counterSnap.data()?.lastVisitNumber;
        if (
          typeof lastN === "number" &&
          Number.isFinite(lastN) &&
          lastN > 0
        ) {
          visitCount = Math.floor(lastN);
        }
      } catch {
        /* keep visitCount from limited booking rows */
      }
      if (visitCount === 0) return null;
      const last = mostRecentBookingByVisit(rows);
      if (!last) {
        return null;
      }
      const mayShareNumber = distinctNameCountFromBookings(rows) > 1;
      return {
        visitCount,
        lastServiceId: last.serviceId,
        lastServiceName: last.serviceName,
        lastVisitDate: last.date || "",
        preferredTime: last.time || "",
        lastCustomerName: last.customerName,
        mayShareNumber,
      };
    }
    const localRows = demoListBookings(shopId).filter(
      (b) => normalizePhone(b.customerPhone) === key
    );
    const last = mostRecentBookingByVisit(localRows);
    const all = demoRead(shopId);
    const profile =
      all[key] ?? (key.length >= 12 ? all[key.slice(-10)] : undefined);

    if (localRows.length > 0 && last) {
      const mayShareNumber = distinctNameCountFromBookings(localRows) > 1;
      return {
        visitCount: effectiveVisitCount(localRows),
        lastServiceId: last.serviceId,
        lastServiceName: last.serviceName,
        lastVisitDate: last.date || "",
        preferredTime: last.time || "",
        lastCustomerName: last.customerName,
        mayShareNumber,
      };
    }
    if (profile && profile.visitCount >= 1) {
      return {
        visitCount: profile.visitCount,
        lastServiceId: profile.lastServiceId,
        lastServiceName: profile.lastServiceName,
        lastVisitDate: profile.lastVisitDate ?? "",
        preferredTime: profile.preferredTime ?? "",
        lastCustomerName: String(profile.customerName ?? ""),
        mayShareNumber: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Demo-only profile row; production history is derived from bookings. */
export async function recordCustomerVisit(
  db: Firestore | null,
  shopId: string,
  input: {
    customerName: string;
    phone: string;
    serviceId: string;
    serviceName: string;
    visitDateIso: string;
    preferredTime: string;
  }
): Promise<void> {
  if (db) return;
  try {
    const key = normalizePhone(input.phone);
    if (!key || key.length !== 12) return;
    const now = Date.now();
    const all = demoRead(shopId);
    const prior =
      all[key] ?? (key.length >= 12 ? all[key.slice(-10)] : undefined);
    const visitCount = (prior?.visitCount ?? 0) + 1;
    all[key] = {
      phoneKey: key,
      customerName: input.customerName.trim(),
      visitCount,
      lastServiceId: input.serviceId,
      lastServiceName: input.serviceName,
      lastVisitTime: now,
      lastVisitDate: input.visitDateIso,
      preferredTime: input.preferredTime,
    };
    demoWrite(shopId, all);
  } catch {
    /* ignore demo storage errors */
  }
}
