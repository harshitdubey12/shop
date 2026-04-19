/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { toast } from "sonner";
import { BARBERS, SERVICES } from "@/lib/data";
import {
  createBooking,
  getBooking,
  listBookingsForShopDate,
} from "@/lib/bookings";
import { buildGoogleCalendarUrl } from "@/lib/calendarUrl";
import {
  demoListBookings,
  demoSaveBooking,
} from "@/lib/demoStore";
import { effectiveVisitCount } from "@/lib/customerVisitStats";
import {
  getReturningCustomerHint,
  recordCustomerVisit,
  type ReturningCustomerHint,
} from "@/lib/customers";
import {
  HOME_REBOOK_INTENT,
  clearRebookPayload,
  rememberLastBookingPhoneForRebook,
  saveRebookPayload,
} from "@/lib/rebookStorage";
import { resolveRebookPayloadForWizard } from "@/lib/rebookResolve";
import { getClientFirestore, isFirebaseConfigured } from "@/lib/firebase";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import { safeBookingAmount } from "@/lib/amounts";
import { getNearbyBookingSuggestions } from "@/lib/nearbySuggestions";
import {
  firstNextAvailableAfter,
  slotsForDateWithCapacity,
} from "@/lib/slotCapacity";
import {
  AUTO_BARBER_ID,
  getActiveStaffMembers,
  staffAsBarbersForWizard,
} from "@/lib/shopStaff";
import { assignStaffForSlot } from "@/lib/staffAssignment";
import { getShop } from "@/lib/shops";
import {
  SUBSCRIPTION_BLOCK_MESSAGE,
  isShopSubscriptionValid,
} from "@/lib/subscription";
import {
  buildMonthMatrix,
  formatClock12,
  formatISODate,
  type TimeSlot,
} from "@/lib/slots";
import {
  buildAppointmentWhatsAppMessage,
  openWhatsAppWithMessage,
} from "@/lib/whatsapp";
import { hasWhatsAppConfigured } from "@/config/brand";
import type { Booking, Shop } from "@/lib/types";
import type { NearbyShopSuggestion } from "@/lib/nearbySuggestions";
import { validateBookingStepPayload } from "@/lib/bookingValidation";
import { normalizePhone } from "@/lib/phone";
import { formatLastVisitRelative } from "@/lib/dateLocal";
import { ShopTenantHeroBar } from "@/components/shop/ShopTenantHeroBar";
import { getBrand } from "@/config/brand";
import { BOOKING_DATA_MISMATCH_MESSAGE } from "@/lib/configMessages";
import { useRouter } from "next/navigation";
import { createSlotHold } from "@/lib/api";
import { useBookingStore } from "@/lib/store";

const steps = [
  "Service",
  "Artist",
  "Date",
  "Time",
  "Details",
] as const;

const CONFETTI = [
  { x: -52, y: -38, r: -12 },
  { x: 48, y: -44, r: 8 },
  { x: -36, y: 28, r: 14 },
  { x: 56, y: 22, r: -6 },
  { x: 0, y: -56, r: 0 },
  { x: -64, y: 8, r: 10 },
  { x: 40, y: 48, r: -14 },
  { x: 72, y: -16, r: 6 },
  { x: -24, y: -52, r: -8 },
  { x: 28, y: 36, r: 12 },
  { x: -72, y: -8, r: 4 },
  { x: 8, y: 52, r: -10 },
] as const;

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#0b0b0b] border-t-transparent ${className ?? ""}`}
      aria-hidden
    />
  );
}

export function BookingWizard({
  shopId,
  shop: shopProp,
  initialTime,
}: {
  shopId: string;
  shop?: Shop | null;
  initialTime?: string | null;
}) {
  const [shop, setShop] = useState<Shop | null>(shopProp ?? null);
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [day, setDay] = useState<number | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedBookingId, setSavedBookingId] = useState<string | null>(null);
  const [perTimeCounts, setPerTimeCounts] = useState<Record<string, number>>(
    {}
  );
  const [sameShopNext, setSameShopNext] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyShopSuggestion[]>([]);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [rebookHint, setRebookHint] = useState<ReturningCustomerHint | null>(
    null
  );
  const [pendingRebookTime, setPendingRebookTime] = useState<string | null>(
    null
  );
  /** Set when user taps a full slot; drives fully booked messaging. */
  const [slotFullLabel, setSlotFullLabel] = useState<string | null>(null);
  /** Nearby routing blocked (location) or Firestore failed. */
  const [nearbyBlockedReason, setNearbyBlockedReason] = useState<
    null | "location" | "failed"
  >(null);

  const router = useRouter();
  const setSlotHold = useBookingStore(s => s.setSlotHold);

  useEffect(() => {
    if (shopProp !== undefined) setShop(shopProp);
  }, [shopProp]);

  useEffect(() => {
    if (shopProp) return;
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      if (!db || !isFirebaseConfigured()) return;
      const s = await getShop(db, shopId);
      if (!cancelled) setShop(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, shopProp]);

  useEffect(() => {
    if (step !== 3) {
      setSlotFullLabel(null);
      setNearbyBlockedReason(null);
    }
  }, [step]);

  const barberChoices = useMemo(() => {
    const base = staffAsBarbersForWizard(shop);
    return [
      ...base,
      {
        id: AUTO_BARBER_ID,
        name: "Any available",
        specialty: "Balanced load",
        image: BARBERS[0]!.image,
      },
    ];
  }, [shop]);

  const service = SERVICES.find((s) => s.id === serviceId);
  const barber = barberChoices.find((b) => b.id === barberId);

  const isoDate =
    day !== null ? formatISODate(cursor.y, cursor.m, day) : null;

  useEffect(() => {
    setSlotFullLabel(null);
    setNearbyBlockedReason(null);
  }, [isoDate]);

  useEffect(() => {
    if (!isoDate) {
      setPerTimeCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      if (db && isFirebaseConfigured()) {
        try {
          const rows = await listBookingsForShopDate(db, shopId, isoDate);
          const counts: Record<string, number> = {};
          for (const b of rows) {
            if (b.status === "cancelled") continue;
            counts[b.time] = (counts[b.time] ?? 0) + 1;
          }
          if (!cancelled) setPerTimeCounts(counts);
        } catch {
          if (!cancelled) {
            toast.error(DATA_LOAD_TOAST);
            setPerTimeCounts({});
          }
        }
      } else {
        const rows = demoListBookings(shopId).filter(
          (b) => b.date === isoDate && b.status !== "cancelled"
        );
        const counts: Record<string, number> = {};
        for (const b of rows) {
          counts[b.time] = (counts[b.time] ?? 0) + 1;
        }
        if (!cancelled) setPerTimeCounts(counts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isoDate, shopId]);

  const slotCapacity = useMemo(
    () => Math.max(1, getActiveStaffMembers(shop).length),
    [shop]
  );

  const slots = useMemo(
    () =>
      isoDate
        ? slotsForDateWithCapacity(isoDate, perTimeCounts, slotCapacity)
        : [],
    [isoDate, perTimeCounts, slotCapacity]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(HOME_REBOOK_INTENT) !== "1") return;
    sessionStorage.removeItem(HOME_REBOOK_INTENT);
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      const p = await resolveRebookPayloadForWizard(
        db && isFirebaseConfigured() ? db : null,
        shopId
      );
      if (cancelled || !p) return;
      clearRebookPayload(shopId);
      const rebookServiceId = p.serviceId?.trim();
      setServiceId(rebookServiceId && rebookServiceId.length > 0 ? rebookServiceId : null);
      setBarberId(AUTO_BARBER_ID);
      setName(p.customerName);
      setPhone(p.customerPhone);
      if (p.time) setPendingRebookTime(p.time);
      if (p.lastVisitDate) {
        const parts = p.lastVisitDate.split("-").map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          setCursor({ y: parts[0], m: parts[1] - 1 });
        }
      }
      setDay(null);
      setTime(null);
      setStep(2);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  useEffect(() => {
    if (step !== 3 || !isoDate || !pendingRebookTime) return;
    const match = slots.find(
      (s) => s.time === pendingRebookTime && s.available
    );
    if (match) {
      setTime(pendingRebookTime);
      setPendingRebookTime(null);
      return;
    }
    const nextAfter = firstNextAvailableAfter(slots, pendingRebookTime);
    if (nextAfter) {
      setTime(nextAfter);
      setPendingRebookTime(null);
      return;
    }
    const firstAny = slots.find((s) => s.available)?.time;
    if (firstAny) {
      setTime(firstAny);
      setPendingRebookTime(null);
      return;
    }
    let cancelled = false;
    const db = getClientFirestore();
    if (!shop || !isoDate || !db || !isFirebaseConfigured()) {
      setPendingRebookTime(null);
      return;
    }
    if (shop.locationIncomplete) {
      setNearby([]);
      setNearbyBlockedReason("location");
      setPendingRebookTime(null);
      return;
    }
    setNearbyBusy(true);
    (async () => {
      try {
        const { suggestions, failed } = await getNearbyBookingSuggestions(
          db,
          shop,
          isoDate
        );
        if (!cancelled) {
          setNearby(suggestions);
          if (failed) {
            toast.error(DATA_LOAD_TOAST);
          }
        }
      } finally {
        if (!cancelled) {
          setNearbyBusy(false);
          setPendingRebookTime(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, isoDate, slots, pendingRebookTime, shop]);

  useEffect(() => {
    if (step !== 4 || normalizePhone(phone).length !== 12) {
      setRebookHint(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      const hint = await getReturningCustomerHint(
        db && isFirebaseConfigured() ? db : null,
        shopId,
        phone
      );
      if (!cancelled) setRebookHint(hint);
    })();
    return () => {
      cancelled = true;
    };
  }, [phone, step, shopId]);

  const initialTimeApplied = useRef(false);
  useEffect(() => {
    if (initialTimeApplied.current || !initialTime || !isoDate) return;
    const match = slots.find((x) => x.time === initialTime);
    if (match?.available) {
      setTime(initialTime);
      setStep(3);
      initialTimeApplied.current = true;
    }
  }, [initialTime, isoDate, slots]);

  const matrix = useMemo(
    () => buildMonthMatrix(cursor.y, cursor.m),
    [cursor.y, cursor.m]
  );

  const today = new Date();
  const isPastDay = (d: number) => {
    const candidate = new Date(cursor.y, cursor.m, d);
    candidate.setHours(0, 0, 0, 0);
    const t = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    return candidate < t;
  };

  const timeLabel = time ? formatClock12(time) : "";

  const blockSubscription = Boolean(
    isFirebaseConfigured() && shop && !isShopSubscriptionValid(shop)
  );

  const openWhatsAppForSaved = () => {
    if (!savedBookingId || !service || !isoDate || !time) return;
    const body = buildAppointmentWhatsAppMessage({
      customerName: name.trim(),
      serviceName: service.name,
      date: isoDate,
      timeLabel,
    });
    const message = `${body}\n\nReference: ${savedBookingId}`;
    if (openWhatsAppWithMessage(message)) {
      toast.success("WhatsApp opened with your booking details");
    } else {
      toast.message("WhatsApp support available at shop", {
        description: "Call the desk to confirm your booking.",
      });
    }
  };

  const submit = async () => {
    if (!service || !barber || !isoDate || !time) return;
    const v = validateBookingStepPayload({
      serviceId: service.id,
      barberId,
      date: isoDate,
      time,
      name,
      phone,
    });
    if (!v.ok) {
      toast.error(v.message);
      return;
    }
    
    setBusy(true);
    try {
      // 1. Create slot hold via FastAPI
      const preferredStaff = barberId === AUTO_BARBER_ID || barberId === null ? undefined : barberId;
      const slotStartUnix = Math.floor(new Date(`${isoDate}T${time}:00`).getTime() / 1000);
      
      const res = await createSlotHold({
        vendor_id: shopId,
        barber_id: preferredStaff,
        slot_start_unix: slotStartUnix
      });

      // 2. Save hold state to Zustand
      setSlotHold(res.hold_id, res.expires_at_unix, {
        vendor_id: shopId,
        barber_id: preferredStaff || null,
        service_id: service.id,
        slot_start_unix: slotStartUnix
      });

      // 3. Save customer form details temporarily (so checkout page can use them)
      sessionStorage.setItem("checkout_customer_name", name.trim());
      sessionStorage.setItem("checkout_customer_phone", normalizePhone(phone));

      // 4. Navigate to checkout
      router.push("/checkout");
      
    } catch (e: any) {
      if (e.response?.status === 409) {
        toast.error("This slot was just booked by someone else.");
      } else {
        toast.error("Failed to hold slot. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const canNext =
    (step === 0 && serviceId) ||
    (step === 1 && barberId) ||
    (step === 2 && day) ||
    (step === 3 && time) ||
    step === 4;

  if (savedBookingId) {
    const phoneOk = normalizePhone(phone).length === 12;
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 lg:px-6 lg:py-28">
        {shop ? <ShopTenantHeroBar shop={shop} /> : null}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="relative overflow-hidden glass-card rounded-3xl border border-[#d4af37]/25 p-8 text-center glow-gold"
        >
          <motion.div
            className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d4af37]/20 blur-3xl"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.35, 1], opacity: [0, 0.55, 0.25] }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          {CONFETTI.map((c, i) => (
            <motion.span
              key={i}
              className="pointer-events-none absolute left-1/2 top-[42%] block h-2 w-2 rounded-sm bg-[#d4af37]/90"
              initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
              animate={{
                opacity: [1, 0],
                x: c.x,
                y: c.y,
                rotate: c.r * 4,
              }}
              transition={{ duration: 1.1, delay: 0.08 + i * 0.02, ease: "easeOut" }}
            />
          ))}
          <div className="relative z-[1]">
          <motion.div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 280, damping: 16, delay: 0.05 }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <motion.path
                d="M5 13l4 4L19 7"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.25, ease: "easeOut" }}
              />
            </svg>
          </motion.div>
          <p className="mt-5 text-xs uppercase tracking-[0.35em] text-[#d4af37]">
            Confirmed
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">
            Booking Confirmed
          </h1>
          <p className="mt-2 text-base text-neutral-300">
            We look forward to serving you
          </p>
          <p className="mt-3 text-sm text-neutral-300">
            {barberId === AUTO_BARBER_ID ? (
              <>
                <span className="text-neutral-400">Assigned to: </span>
                <span className="font-semibold text-white">
                  Any available barber
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-400">You selected: </span>
                <span className="font-semibold text-white">
                  {barber?.name ?? "Barber"}
                </span>
              </>
            )}
          </p>
          {!phoneOk ? (
            <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100/95">
              Add a valid phone number to enable rebooking and customer history
            </p>
          ) : null}
          {service && isoDate && time ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                saveRebookPayload(shopId, {
                  serviceId: service.id,
                  time,
                  customerName: name.trim(),
                  customerPhone: normalizePhone(phone),
                  lastVisitDate: isoDate,
                });
                rememberLastBookingPhoneForRebook(shopId, phone);
                setSavedBookingId(null);
                setServiceId(service.id);
                setBarberId(AUTO_BARBER_ID);
                setPendingRebookTime(time);
                setName(name.trim());
                setPhone(phone);
                const d = isoDate.split("-").map(Number);
                if (d.length === 3 && d[0] && d[1] && d[2]) {
                  setCursor({ y: d[0], m: d[1] - 1 });
                }
                setDay(null);
                setTime(null);
                setStep(2);
              }}
              className="btn-primary btn-ripple mx-auto mt-6 flex min-h-[52px] w-full max-w-md items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-8 py-3.5 text-sm font-bold uppercase tracking-[0.2em] text-[#0b0b0b] glow-gold shadow-[0_0_32px_rgba(212,175,55,0.25)] sm:max-w-lg"
            >
              Book again
            </motion.button>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap sm:justify-center">
            {hasWhatsAppConfigured() ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                onClick={openWhatsAppForSaved}
                className="min-h-[48px] rounded-full border border-[#25D366]/50 bg-[#25D366]/15 px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:shadow-[0_0_28px_rgba(37,211,102,0.25)]"
              >
                Send to WhatsApp
              </motion.button>
            ) : null}
            {service && isoDate && time ? (
              <motion.a
                href={buildGoogleCalendarUrl({
                  title: `${service.name} · ${shop?.name ?? getBrand().name}`,
                  dateIso: isoDate,
                  timeHm: time,
                  durationMins: service.durationMins,
                  details: `Booking reference ${savedBookingId}`,
                })}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/15 px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-200 sm:w-auto"
              >
                Add to Calendar
              </motion.a>
            ) : null}
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
              <Link
                href={`/payment/${savedBookingId}?shop=${encodeURIComponent(shopId)}`}
                className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-[#d4af37]/40 bg-[#d4af37]/8 px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#d4af37] sm:w-auto"
              >
                Payment
              </Link>
            </motion.div>
          </div>
          <p className="mt-6 text-[11px] text-neutral-500">
            {hasWhatsAppConfigured()
              ? "Book again jumps back into the wizard with your last service and time. WhatsApp and Calendar use your booking details."
              : "Book again jumps back into the wizard with your last service and time."}
          </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 lg:px-6 lg:py-28">
      {shop ? <ShopTenantHeroBar shop={shop} /> : null}
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
            Concierge booking
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">
            Reserve your chair
          </h1>
        </div>
        <p className="text-xs text-neutral-500 sm:text-right">
          Step {step + 1} of {steps.length}
        </p>
      </div>

      <div className="mb-10">
        <div className="flex items-center gap-1 sm:gap-2">
          {steps.map((label, i) => (
            <div key={label} className="flex flex-1 flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold uppercase tracking-wide transition ${
                  i === step
                    ? "bg-[#d4af37] text-[#0b0b0b] ring-2 ring-[#d4af37]/40"
                    : i < step
                      ? "border border-[#d4af37]/50 bg-[#d4af37]/15 text-[#d4af37]"
                      : "border border-white/10 bg-white/5 text-neutral-500"
                }`}
              >
                {i + 1}
              </div>
              <p
                className={`mt-2 hidden text-center text-[9px] uppercase tracking-[0.14em] sm:block ${
                  i === step ? "text-[#d4af37]" : "text-neutral-500"
                }`}
              >
                {label}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 h-0.5 w-full rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#d4af37] transition-all duration-500"
            style={{
              width: `${((step + 1) / steps.length) * 100}%`,
            }}
          />
        </div>
        <p className="mt-3 text-center text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:hidden">
          {steps[step]}
        </p>
      </div>

      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="svc"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="space-y-4"
            >
              <p className="text-center text-[11px] leading-relaxed text-neutral-500 sm:text-left">
                Select a service to begin your booking
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
              {SERVICES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setServiceId(s.id)}
                  className={`rounded-2xl border px-4 py-4 text-left transition duration-200 hover:scale-[1.01] active:scale-[0.98] ${
                    serviceId === s.id
                      ? "border-[#d4af37] bg-[#d4af37]/10 glow-gold"
                      : "border-white/10 hover:border-[#d4af37]/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-[#d4af37]">{s.icon}</span>
                    <span className="text-sm font-semibold text-[#d4af37]">
                      ₹{s.price.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <p className="mt-3 font-serif text-lg text-white">{s.name}</p>
                  <p className="mt-2 text-xs text-neutral-400">{s.description}</p>
                </button>
              ))}
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="barber"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="grid gap-4 sm:grid-cols-3"
            >
              {barberChoices.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBarberId(b.id)}
                  className={`rounded-2xl border p-3 text-left transition duration-200 hover:scale-[1.02] active:scale-[0.98] ${
                    barberId === b.id
                      ? "border-[#d4af37] bg-[#d4af37]/10"
                      : "border-white/10 hover:border-[#d4af37]/40"
                  }`}
                >
                  <div className="relative mx-auto aspect-square w-full max-w-[140px] overflow-hidden rounded-2xl">
                    <Image
                      src={b.image}
                      alt={b.name}
                      fill
                      className="object-cover"
                      sizes="140px"
                    />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-white">{b.name}</p>
                  <p className="text-xs text-neutral-500">{b.specialty}</p>
                </button>
              ))}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="date"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs uppercase tracking-[0.2em] text-neutral-400 transition hover:text-white"
                  onClick={() =>
                    setCursor((c) => {
                      const nm = c.m - 1;
                      if (nm < 0) return { y: c.y - 1, m: 11 };
                      return { y: c.y, m: nm };
                    })
                  }
                >
                  Earlier
                </button>
                <p className="font-serif text-lg text-white">
                  {new Date(cursor.y, cursor.m).toLocaleString("en-IN", {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                <button
                  type="button"
                  className="text-xs uppercase tracking-[0.2em] text-neutral-400 transition hover:text-white"
                  onClick={() =>
                    setCursor((c) => {
                      const nm = c.m + 1;
                      if (nm > 11) return { y: c.y + 1, m: 0 };
                      return { y: c.y, m: nm };
                    })
                  }
                >
                  Later
                </button>
              </div>
              <div className="grid grid-cols-7 gap-2 text-center text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d}>{d.slice(0, 1)}</div>
                ))}
              </div>
              <div className="mt-2 space-y-2">
                {matrix.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-2">
                    {week.map((d, di) =>
                      d ? (
                        <button
                          key={di}
                          type="button"
                          disabled={isPastDay(d)}
                          onClick={() => setDay(d)}
                          className={`h-10 rounded-xl text-sm transition active:scale-[0.96] ${
                            isPastDay(d)
                              ? "cursor-not-allowed text-neutral-700"
                              : day === d
                                ? "bg-[#d4af37] text-[#0b0b0b]"
                                : "bg-white/5 text-neutral-200 hover:scale-[1.05] hover:border hover:border-[#d4af37]/50"
                          }`}
                        >
                          {d}
                        </button>
                      ) : (
                        <div key={di} />
                      )
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="time"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <p className="mb-3 text-center text-[11px] leading-relaxed text-neutral-500 sm:text-left">
                Choose your preferred time slot
              </p>
              {slotFullLabel ? (
                <div
                  className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center sm:text-left"
                  role="status"
                >
                  <p className="text-sm font-semibold text-amber-100">
                    {shop?.locationIncomplete
                      ? "Fully booked. Location not configured"
                      : "Fully booked. Try nearby shops instantly"}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {slotFullLabel} is not open. Other times or shops may still have
                    space.
                  </p>
                  {shop?.locationIncomplete ? (
                    <p className="mt-2 text-xs font-medium text-neutral-400">
                      Location not configured
                    </p>
                  ) : null}
                </div>
              ) : null}
              {shop?.locationIncomplete && !slotFullLabel ? (
                <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs text-neutral-400 sm:text-left">
                  Location not configured
                </p>
              ) : null}
              <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-center text-xs text-amber-100/90 sm:text-left">
                Slots fill quickly during peak lunch and evening hours. Lock yours
                while it is still open.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {slots.map((s: TimeSlot) => (
                  <button
                    key={s.time}
                    type="button"
                    onClick={async () => {
                      if (s.available) {
                        setTime(s.time);
                        setSlotFullLabel(null);
                        setNearbyBlockedReason(null);
                        setNearby([]);
                        setSameShopNext(null);
                        return;
                      }
                      setTime(null);
                      setSlotFullLabel(formatClock12(s.time));
                      setNearbyBlockedReason(null);
                      setNearby([]);
                      const nextHere = firstNextAvailableAfter(slots, s.time);
                      setSameShopNext(nextHere);
                      if (!shop || !isoDate) return;
                      if (shop.locationIncomplete) {
                        setNearbyBlockedReason("location");
                        return;
                      }
                      const db = getClientFirestore();
                      if (!db || !isFirebaseConfigured()) return;
                      setNearbyBusy(true);
                      try {
                        const { suggestions, failed } =
                          await getNearbyBookingSuggestions(
                            db,
                            shop,
                            isoDate
                          );
                        setNearby(suggestions);
                        if (failed) {
                          setNearbyBlockedReason("failed");
                        }
                      } finally {
                        setNearbyBusy(false);
                      }
                    }}
                    className={`relative flex min-h-[4.5rem] flex-col items-center justify-center rounded-xl border px-2 py-2.5 text-sm transition duration-200 active:scale-[0.97] ${
                      !s.available
                        ? "cursor-not-allowed border-white/5 text-neutral-600 line-through"
                        : time === s.time
                          ? "border-2 border-[#d4af37] bg-[#d4af37]/25 font-bold text-white shadow-[0_0_28px_rgba(212,175,55,0.28)] ring-2 ring-[#d4af37]/45"
                          : "border border-white/10 text-neutral-200 hover:scale-[1.02] hover:border-[#d4af37]/50"
                    }`}
                  >
                    <span
                      className={
                        time === s.time && s.available
                          ? "font-bold text-white"
                          : ""
                      }
                    >
                      {formatClock12(s.time)}
                    </span>
                    {s.available && s.tag === "popular" ? (
                      <span className="mt-1.5 rounded-full border border-amber-500/30 bg-amber-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-50">
                        Peak time
                      </span>
                    ) : null}
                    {s.available && s.tag === "few_left" ? (
                      <span className="mt-1.5 rounded-full border border-[#d4af37]/35 bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f5e6a8]">
                        Few slots left
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {nearbyBusy ? (
                <p className="mt-4 text-center text-xs text-neutral-500">
                  Finding nearby options…
                </p>
              ) : null}
              {sameShopNext ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-center text-xs text-neutral-200 sm:text-left">
                    Next here: {formatClock12(sameShopNext)}
                  </p>
                  <div className="mt-3 flex justify-center sm:justify-start">
                    <button
                      type="button"
                      onClick={() => {
                        setTime(sameShopNext);
                        setSlotFullLabel(null);
                        setNearbyBlockedReason(null);
                        setSameShopNext(null);
                        setNearby([]);
                      }}
                      className="btn-primary rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0b0b0b]"
                    >
                      Use this time
                    </button>
                  </div>
                </div>
              ) : null}
              {nearbyBlockedReason === "location" ? (
                <p className="mt-4 text-center text-xs text-neutral-500 sm:text-left">
                  Location not configured
                </p>
              ) : null}
              {nearbyBlockedReason === "failed" && nearby.length === 0 ? (
                <p className="mt-4 text-center text-xs text-amber-200/90 sm:text-left">
                  Nearby suggestions unavailable
                </p>
              ) : null}
              {nearby.length > 0 ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-center text-sm font-medium text-neutral-100 sm:text-left">
                    This slot is unavailable. Nearby options:
                  </p>
                  <div className="mt-3 space-y-3">
                    {nearby.map((n) => (
                      <div
                        key={n.shop.id}
                        className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {n.shop.name}
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            {n.distanceKm !== null
                              ? `${n.distanceKm.toFixed(1)} km`
                              : "Nearby"}{" "}
                            · Next{" "}
                            {n.nextAvailableTime
                              ? formatClock12(n.nextAvailableTime)
                              : ""}
                          </p>
                        </div>
                        <Link
                          href={`/app/${n.shop.id}/booking?time=${encodeURIComponent(n.nextAvailableTime ?? "")}`}
                          className="btn-primary inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0b0b0b]"
                        >
                          Book here
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="space-y-4"
            >
              {service && isoDate && time ? (
                <div className="rounded-2xl border border-[#d4af37]/25 bg-black/35 px-4 py-3 text-sm text-neutral-200">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d4af37]/90">
                    Your visit
                  </p>
                  <p className="mt-1 text-white">
                    {service.name} · {isoDate} · {formatClock12(time)}
                  </p>
                  <p className="mt-2 text-xs text-neutral-300">
                    {barberId === AUTO_BARBER_ID ? (
                      <>
                        <span className="text-neutral-400">Assigned to: </span>
                        <span className="font-semibold text-white">
                          Any available barber
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-neutral-400">You selected: </span>
                        <span className="font-semibold text-white">
                          {barber?.name ?? "Barber"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              ) : null}
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  Full name
                </label>
                <input
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none ring-0 focus:border-[#d4af37]/60"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="As it should appear on the roster"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  Phone
                </label>
                <input
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10 digit mobile for day of coordination"
                />
              </div>
              {rebookHint &&
              normalizePhone(phone).length === 12 &&
              rebookHint.visitCount >= 1 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-neutral-300">
                  <p className="text-[11px] text-neutral-200">
                    Returning customer • Visited {rebookHint.visitCount}{" "}
                    {rebookHint.visitCount === 1 ? "time" : "times"}
                  </p>
                  {rebookHint.lastVisitDate ? (
                    <p className="mt-1.5 text-[11px] text-neutral-400">
                      Last visit:{" "}
                      {formatLastVisitRelative(rebookHint.lastVisitDate) ??
                        rebookHint.lastVisitDate}
                    </p>
                  ) : null}
                  {rebookHint.visitCount >= 3 ? (
                    <span className="mt-2 inline-flex rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#d4af37]">
                      Regular Customer
                    </span>
                  ) : null}
                  {rebookHint.mayShareNumber ? (
                    <p className="mt-2 text-[11px] text-neutral-500">
                      May share number
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const nextSid = rebookHint.lastServiceId?.trim();
                      if (nextSid) {
                        setServiceId(nextSid);
                      }
                      setBarberId(AUTO_BARBER_ID);
                      if (rebookHint.preferredTime) {
                        setPendingRebookTime(rebookHint.preferredTime);
                      }
                      if (rebookHint.lastCustomerName) {
                        setName(rebookHint.lastCustomerName);
                      }
                      if (rebookHint.lastVisitDate) {
                        const parts = rebookHint.lastVisitDate
                          .split("-")
                          .map(Number);
                        if (
                          parts.length === 3 &&
                          parts[0] &&
                          parts[1] &&
                          parts[2]
                        ) {
                          setCursor({ y: parts[0], m: parts[1] - 1 });
                        }
                      }
                      setDay(null);
                      setTime(null);
                      setStep(2);
                    }}
                    className="mt-3 w-full rounded-2xl border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d4af37] transition hover:border-[#d4af37]/60 sm:mt-4 sm:w-auto"
                  >
                    Book again
                  </button>
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-neutral-300">
                <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                  Summary
                </p>
                <p className="mt-2 text-white">
                  {service?.name} · {barber?.name}
                </p>
                <p className="text-neutral-400">
                  {isoDate} · {time ? formatClock12(time) : ""}
                </p>
                <p className="mt-2 text-lg font-semibold text-[#d4af37]">
                  ₹{service?.price.toLocaleString("en-IN")}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0}
            className="rounded-2xl border border-white/15 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-200 transition hover:border-[#d4af37]/40 active:scale-[0.98] disabled:opacity-30"
          >
            Back
          </button>
          {step < 4 ? (
            <motion.button
              type="button"
              disabled={!canNext}
              onClick={next}
              whileHover={{ scale: canNext ? 1.03 : 1 }}
              whileTap={{ scale: canNext ? 0.98 : 1 }}
              className="btn-primary rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b] active:scale-[0.98] disabled:opacity-40"
            >
              Continue
            </motion.button>
          ) : (
            <motion.button
              type="button"
              disabled={
                busy ||
                !name.trim() ||
                !phone.trim() ||
                blockSubscription
              }
              onClick={submit}
              whileHover={{
                scale:
                  busy ||
                  !name.trim() ||
                  !phone.trim() ||
                  blockSubscription
                    ? 1
                    : 1.03,
              }}
              whileTap={{
                scale:
                  busy ||
                  !name.trim() ||
                  !phone.trim() ||
                  blockSubscription
                    ? 1
                    : 0.98,
              }}
              className="btn-primary flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b] shadow-[0_0_0_1px_rgba(212,175,55,0.2)] active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Saving…" : "Confirm Booking"}
            </motion.button>
          )}
        </div>
        {step === 4 && blockSubscription ? (
          <p className="mt-4 text-center text-xs text-neutral-500">
            {SUBSCRIPTION_BLOCK_MESSAGE}
          </p>
        ) : null}
      </div>
    </div>
  );
}
