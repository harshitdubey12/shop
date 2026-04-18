"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { Booking, BookingStatus, PaymentStatus, Shop } from "@/lib/types";
import {
  daysRemainingUntilExpiry,
  expiryToneClass,
  getExpiryTone,
} from "@/lib/subscriptionDisplay";
import {
  isShopSubscriptionValid,
} from "@/lib/subscription";
import { openWhatsAppWithMessage } from "@/lib/whatsapp";
import { hasWhatsAppConfigured } from "@/config/brand";
import {
  deleteBooking,
  listBookingsForShop,
  listBookingsLegacy,
  updateBookingStatus,
  updatePaymentStatus,
} from "@/lib/bookings";
import {
  demoDeleteBooking,
  demoListBookings,
  demoUpdateBooking,
} from "@/lib/demoStore";
import {
  getClientAuth,
  getClientFirestore,
  getClientStorage,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { localDateISO } from "@/lib/dateLocal";
import { getBrand } from "@/config/brand";
import { formatClock12 } from "@/lib/slots";
import { getDefaultShopId } from "@/lib/defaultShop";
import {
  describeBusyPattern,
  peakLowTimeInsights,
} from "@/lib/opsHeatmap";
import {
  weekMondayIso,
  weekSundayIsoFromMonday,
  weeklyBookingDayStats,
} from "@/lib/weeklyStats";
import { safeBookingAmount } from "@/lib/amounts";
import { normalizePhone } from "@/lib/phone";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import { effectiveVisitCount } from "@/lib/customerVisitStats";
import { formatBookingBarberForAdmin } from "@/lib/bookingBarberDisplay";
import { getActiveStaffMembers } from "@/lib/shopStaff";

function paymentBadgeLabel(status: PaymentStatus): string {
  if (status === "pending_payment") return "Pending";
  if (status === "paid") return "Paid";
  return "Cash";
}

/** First ": " separates emphasized label from value (times may contain ":"). */
function splitInsightLine(line: string): { prefix: string; suffix: string } {
  const sep = ": ";
  const i = line.indexOf(sep);
  if (i === -1) return { prefix: line, suffix: "" };
  return { prefix: line.slice(0, i), suffix: line.slice(i + sep.length) };
}

const UPCOMING_SCOPE_HINT =
  "Upcoming includes confirmed and pending bookings";

function UpcomingInfoHint() {
  return (
    <span
      className="inline-flex shrink-0 cursor-help text-neutral-500 hover:text-neutral-400"
      title={UPCOMING_SCOPE_HINT}
      aria-label={UPCOMING_SCOPE_HINT}
      role="img"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function formatBookingStatusLabel(status: BookingStatus): string {
  const labels: Record<BookingStatus, string> = {
    pending: "Upcoming",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "No Show",
  };
  return labels[status] ?? status;
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    pending_payment:
      "border-amber-500/55 bg-amber-500/18 text-amber-50 shadow-[0_0_12px_rgba(245,158,11,0.12)]",
    paid: "border-emerald-500/55 bg-emerald-500/18 text-emerald-50 shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    cash: "border-sky-500/55 bg-sky-500/18 text-sky-50 shadow-[0_0_12px_rgba(14,165,233,0.12)]",
  };
  return (
    <span
      className={`inline-flex min-h-[1.5rem] items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${styles[status]}`}
    >
      {paymentBadgeLabel(status)}
    </span>
  );
}

/** Schedule strip uses four operator facing labels. */
function ScheduleRowStatusBadge({ status }: { status: BookingStatus }) {
  const label =
    status === "pending" || status === "confirmed"
      ? "Upcoming"
      : status === "completed"
        ? "Completed"
        : status === "cancelled"
          ? "Cancelled"
          : "No Show";
  const styleKey: BookingStatus =
    status === "confirmed" ? "pending" : status;
  const styles: Record<BookingStatus, string> = {
    pending:
      "border-sky-500/55 bg-sky-500/18 text-sky-50 shadow-[0_0_12px_rgba(14,165,233,0.12)]",
    confirmed:
      "border-blue-500/55 bg-blue-500/18 text-blue-50 shadow-[0_0_12px_rgba(59,130,246,0.12)]",
    completed:
      "border-emerald-500/55 bg-emerald-500/18 text-emerald-50 shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    cancelled:
      "border-red-500/55 bg-red-500/18 text-red-50 shadow-[0_0_12px_rgba(239,68,68,0.12)]",
    no_show:
      "border-white/25 bg-white/12 text-neutral-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
  };
  const cls = styles[styleKey] ?? styles.pending;
  return (
    <span
      title={label === "Upcoming" ? UPCOMING_SCOPE_HINT : undefined}
      className={`inline-flex min-h-[1.5rem] items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${cls}`}
    >
      {label}
    </span>
  );
}

function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const styles: Record<BookingStatus, string> = {
    pending:
      "border-sky-500/55 bg-sky-500/18 text-sky-50 shadow-[0_0_12px_rgba(14,165,233,0.12)]",
    confirmed:
      "border-blue-500/55 bg-blue-500/18 text-blue-50 shadow-[0_0_12px_rgba(59,130,246,0.12)]",
    completed:
      "border-emerald-500/55 bg-emerald-500/18 text-emerald-50 shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    cancelled:
      "border-red-500/55 bg-red-500/18 text-red-50 shadow-[0_0_12px_rgba(239,68,68,0.12)]",
    no_show:
      "border-white/25 bg-white/12 text-neutral-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
  };
  return (
    <span
      className={`inline-flex min-h-[1.5rem] items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${styles[status]}`}
    >
      {formatBookingStatusLabel(status)}
    </span>
  );
}

function AdminEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card mt-14 flex flex-col items-center justify-center rounded-2xl border border-white/10 px-6 py-20 text-center"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#d4af37]"
        aria-hidden
      >
        <svg
          className="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <rect x="3" y="5" width="18" height="15" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </div>
      <p className="mt-6 font-serif text-2xl text-white">No bookings yet</p>
      <p className="mt-2 max-w-sm text-sm text-neutral-500">
        Bookings will appear here once customers start scheduling through the
        guest site.
      </p>
    </motion.div>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 8 }).map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 w-full animate-pulse rounded bg-white/10" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function resolveMutationShopId(
  row: Booking,
  dashboardShopId: string | null | undefined
): string | null {
  if (dashboardShopId) return dashboardShopId;
  if (row.shopId) return row.shopId;
  return null;
}

export function AdminDashboard({
  shopId: dashboardShopId,
  shop: liveShop,
}: {
  /** When set, loads nested bookings for that shop. When omitted, uses legacy root collection. */
  shopId?: string | null;
  /** Live shop doc from dashboard (expiry, flags). Optional for legacy /admin route. */
  shop?: Shop | null;
} = {}) {
  const router = useRouter();
  const brand = getBrand();
  const [rows, setRows] = useState<Booking[]>([]);
  const [status, setStatus] = useState<"all" | BookingStatus>("all");
  const [barberFilter, setBarberFilter] = useState<"all" | "any" | string>(
    "all"
  );
  const [date, setDate] = useState("");
  const [listScope, setListScope] = useState<"today" | "all">("all");
  const [loading, setLoading] = useState(true);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(
    null
  );
  const [proofModalUrl, setProofModalUrl] = useState<string | null>(null);
  const [resolvedProofUrls, setResolvedProofUrls] = useState<
    Record<string, string>
  >({});

  function isResolvableStoragePath(url: string | null | undefined): boolean {
    if (!url) return false;
    if (url.startsWith("http") || url.startsWith("blob:")) return false;
    return url.startsWith("paymentProofs/");
  }

  useEffect(() => {
    const storage = getClientStorage();
    if (!storage || !isFirebaseConfigured()) {
      const next: Record<string, string> = {};
      for (const b of rows) {
        if (b.paymentProofUrl) next[b.id] = b.paymentProofUrl;
      }
      setResolvedProofUrls(next);
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const b of rows) {
        const raw = b.paymentProofUrl;
        if (!raw) continue;
        if (!isResolvableStoragePath(raw)) {
          next[b.id] = raw;
          continue;
        }
        try {
          next[b.id] = await getDownloadURL(storageRef(storage, raw));
        } catch {
          /* proof URL resolve failed; row stays without preview */
        }
      }
      if (!cancelled) setResolvedProofUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = getClientFirestore();
      let list: Booking[] = [];
      if (db && isFirebaseConfigured()) {
        list = dashboardShopId
          ? await listBookingsForShop(db, dashboardShopId)
          : await listBookingsLegacy(db);
      } else {
        list = demoListBookings(
          dashboardShopId ?? getDefaultShopId()
        );
      }
      setRows(list);
    } catch (e) {
      const isFs =
        e instanceof Error && e.name === "FirestoreQueryError";
      toast.error(isFs ? e.message : DATA_LOAD_TOAST);
    } finally {
      setLoading(false);
    }
  }, [dashboardShopId]);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth || !isFirebaseConfigured()) {
      router.replace("/admin/login");
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/admin/login");
        return;
      }
      void load();
    });
    return () => unsub();
  }, [router, load]);

  const todayIso = localDateISO();

  const todayRows = useMemo(
    () => rows.filter((b) => b.date === todayIso),
    [rows, todayIso]
  );

  const rowsForTable = useMemo(() => {
    if (listScope === "today") return rows.filter((b) => b.date === todayIso);
    return rows;
  }, [rows, listScope, todayIso]);

  const barberFilterOptions = useMemo(
    () => getActiveStaffMembers(liveShop ?? null),
    [liveShop]
  );

  const filtered = useMemo(() => {
    return rowsForTable.filter((b) => {
      if (status !== "all" && b.status !== status) return false;
      if (listScope === "all" && date && b.date !== date) return false;
      if (barberFilter !== "all") {
        if (barberFilter === "any") {
          const pool = !b.assignedBarberId && !b.barberId;
          if (!pool) return false;
        } else {
          const key = b.assignedBarberId ?? b.barberId;
          if (key !== barberFilter) return false;
        }
      }
      return true;
    });
  }, [rowsForTable, status, date, barberFilter, listScope]);

  const scheduleSorted = useMemo(
    () => [...todayRows].sort((a, b) => a.time.localeCompare(b.time)),
    [todayRows]
  );

  const barberLoadToday = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const b of todayRows) {
      if (b.status === "cancelled") continue;
      const pool = !b.assignedBarberId && !b.barberId;
      const key = pool
        ? "__any__"
        : String(b.assignedBarberId ?? b.barberId ?? "__any__");
      const label = pool ? "Any available" : formatBookingBarberForAdmin(b);
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { label, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }, [todayRows]);

  const pendingPaymentsList = useMemo(
    () =>
      [...todayRows]
        .filter(
          (b) =>
            b.paymentStatus === "pending_payment" && b.status !== "cancelled"
        )
        .sort((a, b) => a.time.localeCompare(b.time)),
    [todayRows]
  );

  const todayOverview = useMemo(() => {
    try {
      const tr = rows.filter((b) => b.date === todayIso);
      const completed = tr.filter((b) => b.status === "completed").length;
      const noShow = tr.filter((b) => b.status === "no_show").length;
      const pendingUpcoming = tr.filter(
        (b) => b.status === "pending" || b.status === "confirmed"
      ).length;
      const earnings = tr
        .filter((b) => b.status === "completed")
        .reduce((s, b) => s + safeBookingAmount(b.amount), 0);
      return {
        count: tr.length,
        completed,
        earnings,
        noShow,
        pendingUpcoming,
      };
    } catch {
      return {
        count: 0,
        completed: 0,
        earnings: 0,
        noShow: 0,
        pendingUpcoming: 0,
      };
    }
  }, [rows, todayIso]);

  const weekStartIso = useMemo(() => {
    const parts = todayIso.split("-").map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      return weekMondayIso(new Date(parts[0], parts[1] - 1, parts[2]));
    }
    return weekMondayIso(new Date());
  }, [todayIso]);
  const weekEndIso = useMemo(
    () => weekSundayIsoFromMonday(weekStartIso),
    [weekStartIso]
  );

  const weeklyOverview = useMemo(() => {
    try {
      return weeklyBookingDayStats(rows, weekStartIso, weekEndIso);
    } catch {
      return { total: 0, busiestDay: "—", leastBusyDay: "—" };
    }
  }, [rows, weekStartIso, weekEndIso]);

  const heatLabels = useMemo(
    () => describeBusyPattern(todayRows),
    [todayRows]
  );

  const analyticsLines = useMemo(
    () => peakLowTimeInsights(rows),
    [rows]
  );

  const { visitCountByPhone, repeatGuests } = useMemo(() => {
    const by = new Map<string, Booking[]>();
    for (const b of rows) {
      const k = normalizePhone(b.customerPhone);
      if (k.length !== 12) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(b);
    }
    const visitCountByPhone = new Map<string, number>();
    const repeatGuests: { phone: string; name: string; n: number }[] = [];
    for (const [k, list] of by) {
      let n = effectiveVisitCount(list);
      for (const b of list) {
        const vn = b.customerVisitNumber;
        if (typeof vn === "number" && Number.isFinite(vn)) {
          n = Math.max(n, vn);
        }
      }
      visitCountByPhone.set(k, n);
      if (n < 2) continue;
      const latest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0]!;
      const nameKeys = new Set(
        list
          .map((x) => x.customerName.trim().toLowerCase())
          .filter(Boolean)
      );
      let label = latest.customerName.trim();
      if (nameKeys.size > 1) {
        label = `${label} (may share number)`;
      }
      repeatGuests.push({ phone: k, name: label, n });
    }
    return {
      visitCountByPhone,
      repeatGuests: repeatGuests.slice(0, 16),
    };
  }, [rows]);

  const sharedPhoneKeys = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const b of rows) {
      const k = normalizePhone(b.customerPhone);
      if (k.length !== 12) continue;
      if (!m.has(k)) m.set(k, new Set());
      const nm = b.customerName.trim().toLowerCase();
      if (nm) m.get(k)!.add(nm);
    }
    const out = new Set<string>();
    for (const [k, names] of m) {
      if (names.size > 1) out.add(k);
    }
    return out;
  }, [rows]);

  const repeatCustomersToday = useMemo(() => {
    let n = 0;
    const seen = new Set<string>();
    for (const b of todayRows) {
      const k = normalizePhone(b.customerPhone);
      if (k.length !== 12) continue;
      if (seen.has(k)) continue;
      if ((visitCountByPhone.get(k) ?? 0) >= 2) {
        seen.add(k);
        n += 1;
      }
    }
    return n;
  }, [todayRows, visitCountByPhone]);

  const patchRemote = async (
    id: string,
    fn: () => Promise<void>,
    successMessage?: string
  ) => {
    setPendingBookingId(id);
    try {
      await fn();
      await load();
      if (successMessage) toast.success(successMessage);
    } catch (e) {
      const isFs =
        e instanceof Error && e.name === "FirestoreQueryError";
      toast.error(isFs ? e.message : DATA_LOAD_TOAST);
    } finally {
      setPendingBookingId(null);
    }
  };

  const confirm = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await updateBookingStatus(db, sid, b.id, "confirmed");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), b.id, {
          status: "confirmed",
        });
      }
    }, "Booking status updated to confirmed");

  const markPaymentPaid = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await updatePaymentStatus(db, sid, b.id, "paid");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), b.id, {
          paymentStatus: "paid",
        });
      }
    }, "Updated successfully");

  const complete = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await updateBookingStatus(db, sid, b.id, "completed");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), b.id, {
          status: "completed",
        });
      }
    }, "Updated successfully");

  const cancel = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await updateBookingStatus(db, sid, b.id, "cancelled");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), b.id, {
          status: "cancelled",
        });
      }
    }, "Updated successfully");

  const markNoShow = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await updateBookingStatus(db, sid, b.id, "no_show");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), b.id, {
          status: "no_show",
        });
      }
    }, "Marked as no-show");

  const remove = (b: Booking) =>
    patchRemote(b.id, async () => {
      const db = getClientFirestore();
      const sid = resolveMutationShopId(b, dashboardShopId);
      if (db && isFirebaseConfigured()) {
        await deleteBooking(db, sid, b.id);
      } else {
        demoDeleteBooking(sid ?? getDefaultShopId(), b.id);
      }
    }, "Booking removed from the list");

  const logout = async () => {
    const auth = getClientAuth();
    if (auth) await signOut(auth);
    router.replace("/admin/login");
  };

  const actionsLocked = pendingBookingId !== null;

  const subscriptionBanner = useMemo(() => {
    if (!liveShop || !Number.isFinite(liveShop.expiryDate)) return null;
    const dr = daysRemainingUntilExpiry(liveShop.expiryDate);
    const expired = dr < 0 || !isShopSubscriptionValid(liveShop);
    const tone = getExpiryTone(expired ? -1 : dr);
    const cls = expiryToneClass(tone);
    let line = "";
    if (expired) {
      line = "Subscription expired";
    } else if (dr === 0) {
      line = "Your subscription expires today";
    } else if (dr > 0 && dr <= 3) {
      line = `Your subscription expires in ${dr} days`;
    } else {
      line = `Expires in ${dr} days`;
    }
    const needsRenewCta = expired || dr <= 3;
    const showWhatsappRenew =
      needsRenewCta && hasWhatsAppConfigured();
    const showAdminRenewMessage =
      needsRenewCta && !hasWhatsAppConfigured();
    let shellClass = "border-white/10 bg-white/[0.02]";
    if (expired) {
      shellClass = "border-red-500/45 bg-red-500/10";
    } else if (!expired && dr >= 0 && dr < 3) {
      shellClass = "border-amber-500/45 bg-amber-500/12";
    }
    return { line, cls, showWhatsappRenew, showAdminRenewMessage, shellClass };
  }, [liveShop]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 lg:px-6">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
            Concierge console
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white">{brand.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">Bookings</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={listScope}
            onChange={(e) =>
              setListScope(e.target.value as "today" | "all")
            }
            className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
          >
            <option value="today">Today</option>
            <option value="all">All dates</option>
          </select>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as typeof status)
            }
            className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
          >
            <option value="all">All statuses</option>
            <option value="pending">Upcoming</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No-show</option>
          </select>
          <select
            value={barberFilter}
            onChange={(e) => setBarberFilter(e.target.value)}
            className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
          >
            <option value="all">All barbers</option>
            <option value="any">Any available</option>
            {barberFilterOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            disabled={listScope === "today"}
            title={
              listScope === "today"
                ? "Switch to All dates to filter by calendar day"
                : undefined
            }
            onChange={(e) => setDate(e.target.value)}
            className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => {
              setDate("");
              setStatus("all");
              setBarberFilter("all");
              setListScope("all");
              toast.success("Filters cleared");
            }}
            className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-neutral-200 transition hover:scale-[1.02] active:scale-[0.98]"
          >
            Reset filters
          </button>
          {isFirebaseConfigured() && (
            <button
              type="button"
              onClick={logout}
              className="rounded-full bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white transition hover:scale-[1.02]"
            >
              Log out
            </button>
          )}
        </div>
      </div>

      {subscriptionBanner ? (
        <div
          className={`glass-card mt-10 rounded-2xl border p-4 ${subscriptionBanner.shellClass}`}
        >
          <p className={`text-sm ${subscriptionBanner.cls}`}>
            {subscriptionBanner.line}
          </p>
          {subscriptionBanner.showWhatsappRenew ? (
            <button
              type="button"
              onClick={() => {
                openWhatsAppWithMessage(
                  "Hi, I want to renew my subscription"
                );
              }}
              className="mt-3 rounded-full border border-[#d4af37]/45 bg-[#d4af37]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#d4af37] transition hover:scale-[1.02]"
            >
              Renew via WhatsApp
            </button>
          ) : null}
          {subscriptionBanner.showAdminRenewMessage ? (
            <p className="mt-3 text-sm text-neutral-400">
              Contact admin to renew your subscription
            </p>
          ) : null}
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <AdminEmptyState />
      ) : (
        <>
      <section className="glass-card mt-10 rounded-2xl border border-white/10 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
          Today&apos;s Overview
        </h2>
        {loading ? (
          <div className="mt-4 h-20 animate-pulse rounded-2xl bg-white/5" />
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                  Total today
                </p>
                <p className="mt-1 font-serif text-2xl text-white">
                  {todayOverview.count}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                  Completed
                </p>
                <p className="mt-1 font-serif text-2xl text-white">
                  {todayOverview.completed}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-1">
                  <p className="text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                    Pending / upcoming
                  </p>
                  <UpcomingInfoHint />
                </div>
                <p className="mt-1 font-serif text-2xl text-white">
                  {todayOverview.pendingUpcoming}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                  Revenue (completed only)
                </p>
                <p className="mt-1 font-serif text-2xl text-[#d4af37]">
                  ₹{todayOverview.earnings.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
                todayOverview.noShow > 0
                  ? "border-amber-500/45 bg-amber-500/12 text-amber-100"
                  : "border-white/10 bg-white/[0.02] text-neutral-300"
              }`}
            >
              No shows today: {todayOverview.noShow}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
              Week {weekStartIso}–{weekEndIso}: {weeklyOverview.total} bookings.
              Busiest {weeklyOverview.busiestDay}, slowest{" "}
              {weeklyOverview.leastBusyDay}.
            </p>
            <div className="mt-4 space-y-2.5 rounded-xl border border-[#d4af37]/25 bg-black/35 px-4 py-3">
              {(() => {
                const peakParts = splitInsightLine(analyticsLines.peakRange);
                const lowParts = splitInsightLine(analyticsLines.lowRange);
                return (
                  <>
                    <p className="text-sm leading-snug text-neutral-200">
                      <span className="font-semibold uppercase tracking-[0.12em] text-[#d4af37]">
                        {peakParts.prefix}
                      </span>
                      {peakParts.suffix ? (
                        <>
                          <span className="text-neutral-400">: </span>
                          <span className="text-neutral-400">
                            {peakParts.suffix}
                          </span>
                        </>
                      ) : null}
                    </p>
                    <p className="text-sm leading-snug text-neutral-200">
                      <span className="font-semibold uppercase tracking-[0.12em] text-[#d4af37]">
                        {lowParts.prefix}
                      </span>
                      {lowParts.suffix ? (
                        <>
                          <span className="text-neutral-400">: </span>
                          <span className="text-neutral-400">
                            {lowParts.suffix}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </>
                );
              })()}
              <p className="text-sm leading-snug text-neutral-200">
                <span className="font-semibold uppercase tracking-[0.12em] text-[#d4af37]">
                  Repeat customers today
                </span>
                <span className="text-neutral-400">: </span>
                <span className="font-mono text-lg text-white tabular-nums">
                  {repeatCustomersToday}
                </span>
              </p>
              <p className="border-t border-white/10 pt-2 text-[11px] text-neutral-500">
                {heatLabels.peakLabel} · {heatLabels.lowLabel}
              </p>
            </div>
            {liveShop ? (
              <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
                Total bookings (shop):{" "}
                {typeof liveShop.totalBookings === "number" &&
                Number.isFinite(liveShop.totalBookings)
                  ? liveShop.totalBookings
                  : "—"}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="glass-card mt-10 rounded-2xl border border-white/10 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
              Today&apos;s schedule
            </h2>
            <UpcomingInfoHint />
          </div>
          <p className="text-xs text-neutral-500">{todayIso}</p>
        </div>
        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((k) => (
              <div
                key={k}
                className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/5"
              />
            ))}
          </div>
        ) : scheduleSorted.length === 0 ? (
          <div className="mt-4 flex min-h-[11rem] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center">
            <p className="text-sm text-neutral-500">No bookings for today</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {scheduleSorted.map((b) => {
              const noShowRow = b.status === "no_show";
              return (
                <motion.div
                  key={b.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-2xl border p-4 transition ${
                    noShowRow
                      ? "border-amber-500/45 bg-amber-500/10 ring-1 ring-amber-500/35"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold text-white">
                        {formatClock12(b.time)}
                      </p>
                      <p className="mt-1 text-sm text-white">
                        {b.customerName}
                        <span className="text-neutral-500"> · </span>
                        <span className="text-[#d4af37]">{b.serviceName}</span>
                      </p>
                      <p className="mt-2 text-xs text-neutral-200">
                        <span className="font-bold uppercase tracking-[0.12em] text-[#d4af37]">
                          Barber
                        </span>
                        {": "}
                        {formatBookingBarberForAdmin(b)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <ScheduleRowStatusBadge status={b.status} />
                        <PaymentBadge status={b.paymentStatus} />
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-200 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => complete(b)}
                        disabled={
                          actionsLocked || b.status === "completed"
                        }
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => cancel(b)}
                        disabled={actionsLocked}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-[#d4af37]/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37] transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => markPaymentPaid(b)}
                        disabled={
                          actionsLocked ||
                          b.paymentStatus === "paid" ||
                          b.paymentStatus === "cash"
                        }
                      >
                        Mark as paid
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      <section className="glass-card mt-8 rounded-2xl border border-white/10 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
          Barber load (today)
        </h2>
        {loading ? (
          <div className="mt-3 h-10 animate-pulse rounded-xl bg-white/5" />
        ) : barberLoadToday.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No active bookings counted for today.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-neutral-200">
            {barberLoadToday.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="font-medium text-white">{row.label}</span>
                <span className="tabular-nums text-[#d4af37]">
                  {row.count} booking{row.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass-card mt-8 rounded-2xl border border-white/10 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
          Pending payments
        </h2>
        {loading ? (
          <div className="mt-3 h-16 animate-pulse rounded-xl bg-white/5" />
        ) : pendingPaymentsList.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            Nothing waiting on payment for today.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pendingPaymentsList.map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/08 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {b.customerName}
                  </p>
                  <p className="text-xs text-neutral-400">
                    ₹{safeBookingAmount(b.amount).toLocaleString("en-IN")} ·{" "}
                    {formatClock12(b.time)}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-[#d4af37]/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37] transition hover:scale-[1.02] disabled:opacity-40"
                  onClick={() => markPaymentPaid(b)}
                  disabled={
                    actionsLocked ||
                    b.paymentStatus === "paid" ||
                    b.paymentStatus === "cash"
                  }
                >
                  Mark as paid
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {repeatGuests.length > 0 ? (
        <section className="glass-card mt-8 rounded-2xl border border-white/10 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
            Returning guests
          </h2>
          <div className="mt-3 space-y-2 text-xs text-neutral-300">
            {repeatGuests.map((g) => (
              <p key={g.phone}>
                {g.name} · {g.phone} · Visited {g.n} times
                {g.n >= 3 ? " · Regular Customer" : ""}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="glass-card mt-12 overflow-x-auto rounded-2xl border border-white/10">
        <p className="border-b border-white/10 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
          All bookings
          {listScope === "today" ? " (today only)" : ""} · filters apply below
        </p>
        <table className="min-w-full divide-y divide-white/10 text-left text-xs text-neutral-200">
          <thead className="border-b border-[#d4af37]/20 bg-white/[0.06] text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d4af37]/90">
            <tr>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Barber</th>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">
                <span className="block text-[#d4af37]">Booking status</span>
              </th>
              <th className="px-4 py-3">
                <span className="block text-[#d4af37]">Payment status</span>
              </th>
              <th className="px-4 py-3 text-neutral-400">Proof</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && <TableSkeleton />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  No rows for this filter.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((b) => (
                <tr
                  key={b.id}
                  className={
                    b.status === "no_show"
                      ? "align-top bg-amber-500/08 ring-1 ring-inset ring-amber-500/25"
                      : "align-top"
                  }
                >
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{b.customerName}</p>
                    <p className="text-[11px] text-neutral-500">
                      {b.customerPhone}
                    </p>
                    {(() => {
                      const k = normalizePhone(b.customerPhone);
                      const n =
                        k.length === 12 ? (visitCountByPhone.get(k) ?? 0) : 0;
                      if (k.length !== 12) return null;
                      if (n <= 1) {
                        return (
                          <>
                            <p className="mt-1 text-[10px] text-emerald-200/90">
                              New Customer
                            </p>
                            {sharedPhoneKeys.has(k) ? (
                              <p className="mt-0.5 text-[10px] text-neutral-500">
                                May share number
                              </p>
                            ) : null}
                          </>
                        );
                      }
                      return (
                        <>
                          <p className="mt-1 text-[10px] text-[#d4af37]/90">
                            Returning Customer ({n} visits)
                            {n >= 3 ? (
                              <span className="ml-2 rounded-full border border-[#d4af37]/35 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#d4af37]">
                                Regular Customer
                              </span>
                            ) : null}
                          </p>
                          {sharedPhoneKeys.has(k) ? (
                            <p className="mt-0.5 text-[10px] text-neutral-500">
                              May share number
                            </p>
                          ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    {b.serviceName}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-neutral-300">
                    <span className="font-semibold text-neutral-200">
                      Barber:
                    </span>{" "}
                    {formatBookingBarberForAdmin(b)}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-neutral-300">
                    {b.date} {formatClock12(b.time)}
                  </td>
                  <td className="px-4 py-3">
                    <BookingStatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge status={b.paymentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      if (!b.paymentProofUrl) {
                        return <span className="text-neutral-600">—</span>;
                      }
                      const thumb = resolvedProofUrls[b.id];
                      const needsResolve = isResolvableStoragePath(
                        b.paymentProofUrl
                      );
                      const ready =
                        !!thumb &&
                        (thumb.startsWith("http") ||
                          thumb.startsWith("blob:"));
                      if (needsResolve && !ready) {
                        return (
                          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[9px] text-neutral-500">
                            …
                          </span>
                        );
                      }
                      if (!thumb) {
                        return (
                          <span className="text-neutral-600">—</span>
                        );
                      }
                      return (
                        <button
                          type="button"
                          title="Tap to open payment proof"
                          onClick={() => setProofModalUrl(thumb)}
                          className="group block rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumb}
                            alt="Payment proof thumbnail"
                            className="h-12 w-12 rounded-lg object-cover transition group-hover:opacity-90"
                          />
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className="rounded-full border border-[#d4af37]/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37] transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => confirm(b)}
                        disabled={
                          actionsLocked ||
                          b.status === "confirmed" ||
                          b.status === "completed" ||
                          b.status === "no_show"
                        }
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-emerald-500/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => markPaymentPaid(b)}
                        disabled={
                          actionsLocked ||
                          b.paymentStatus === "paid" ||
                          b.paymentStatus === "cash"
                        }
                      >
                        Mark as paid
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-200 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => complete(b)}
                        disabled={actionsLocked || b.status === "completed"}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => cancel(b)}
                        disabled={actionsLocked}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-amber-500/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => markNoShow(b)}
                        disabled={actionsLocked || b.status === "no_show"}
                      >
                        No-show
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-red-500/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300 transition hover:scale-[1.02] disabled:opacity-40"
                        onClick={() => remove(b)}
                        disabled={actionsLocked}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
        </>
      )}

      <AnimatePresence>
        {proofModalUrl ? (
          <motion.div
            key={proofModalUrl}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setProofModalUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]"
            >
              <button
                type="button"
                className="absolute right-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-[0.16em] text-white"
                onClick={() => setProofModalUrl(null)}
              >
                Close
              </button>
              <div className="relative max-h-[80vh] w-full p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={proofModalUrl}
                  alt="Payment proof full size"
                  className="mx-auto max-h-[75vh] w-auto max-w-full object-contain"
                />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
