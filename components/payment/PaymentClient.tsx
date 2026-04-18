"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { Booking, PaymentStatus } from "@/lib/types";
import { getBooking, getBookingFlexible, updatePaymentStatus } from "@/lib/bookings";
import { demoGetBooking, demoUpdateBooking } from "@/lib/demoStore";
import {
  getClientFirestore,
  getClientStorage,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { buildGooglePayUri, buildUpiUri } from "@/lib/paymentUrls";
import {
  formatPhoneDisplay,
  getBrand,
  hasUpiConfigured,
  hasWhatsAppConfigured,
  setClientBrandMerge,
} from "@/config/brand";
import { getShop, shopWhatsAppNumber } from "@/lib/shops";
import { uploadPaymentProofImage } from "@/lib/paymentProofUpload";
import { formatClock12 } from "@/lib/slots";
import { getDefaultShopId } from "@/lib/defaultShop";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import {
  BOOKING_DATA_MISMATCH_MESSAGE,
  BOOKING_NOT_FOUND_MESSAGE,
  PAYMENT_SHOP_QUERY_MISSING_MESSAGE,
} from "@/lib/configMessages";
import { safeBookingAmount } from "@/lib/amounts";
import { formatBookingBarberForDisplay } from "@/lib/bookingBarberDisplay";

/**
 * Shop id for payment reads and writes. Query `shop` wins so URL cannot be
 * overridden by stale `booking.shopId` on the client.
 */
function paymentShopId(
  booking: Booking | null,
  shopIdFromUrl?: string
): string | null {
  if (shopIdFromUrl) return shopIdFromUrl;
  if (booking?.shopId) return booking.shopId;
  return null;
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className ?? ""}`}
      aria-hidden
    />
  );
}

export function PaymentClient({
  id,
  shopId: shopIdProp,
}: {
  id: string;
  shopId?: string;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<
    null | "not_found" | "mismatch" | "invalid_id" | "network"
  >(null);
  const [paidAnim, setPaidAnim] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [payBusy, setPayBusy] = useState<"paid" | "cash" | null>(null);
  const [localProofPreview, setLocalProofPreview] = useState<string | null>(
    null
  );
  const markPaidInFlight = useRef(false);

  const brand = getBrand();
  const hasUpi = hasUpiConfigured();

  const verifyBookingForPayment = useCallback(
    async (current: Booking): Promise<Booking | null> => {
      try {
        const db = getClientFirestore();
        const sid = paymentShopId(current, shopIdProp);
        if (!sid) {
          toast.error(BOOKING_NOT_FOUND_MESSAGE);
          return null;
        }
        if (db && isFirebaseConfigured()) {
          const fresh = await getBooking(db, current.id, sid);
          if (!fresh) {
            toast.error(
              shopIdProp
                ? BOOKING_DATA_MISMATCH_MESSAGE
                : BOOKING_NOT_FOUND_MESSAGE
            );
            return null;
          }
          if (shopIdProp && fresh.shopId !== shopIdProp) {
            toast.error(BOOKING_DATA_MISMATCH_MESSAGE);
            return null;
          }
          return fresh;
        }
        const dSid = sid ?? getDefaultShopId();
        const fresh = demoGetBooking(dSid, current.id);
        if (!fresh) {
          toast.error(
            shopIdProp
              ? BOOKING_DATA_MISMATCH_MESSAGE
              : BOOKING_NOT_FOUND_MESSAGE
          );
          return null;
        }
        if (shopIdProp && fresh.shopId !== shopIdProp) {
          toast.error(BOOKING_DATA_MISMATCH_MESSAGE);
          return null;
        }
        return fresh;
      } catch (e) {
        const isFs =
          e instanceof Error && e.name === "FirestoreQueryError";
        toast.error(isFs ? e.message : DATA_LOAD_TOAST);
        return null;
      }
    },
    [shopIdProp]
  );

  const revokePreview = useCallback((url: string | null) => {
    if (url && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setBooking(null);
      const trimmedId = id?.trim() ?? "";
      if (!trimmedId) {
        if (!cancelled) {
          setLoadError("invalid_id");
          setLoading(false);
        }
        return;
      }
      try {
        const db = getClientFirestore();
        let b: Booking | null = null;
        if (db && isFirebaseConfigured()) {
          if (shopIdProp) {
            b = await getBooking(db, trimmedId, shopIdProp);
            if (!b) {
              if (!cancelled) {
                setBooking(null);
                setLoadError("mismatch");
              }
            }
          } else {
            b = await getBookingFlexible(db, trimmedId, null);
            if (!b && !cancelled) {
              setBooking(null);
              setLoadError("not_found");
            }
          }
        } else {
          if (shopIdProp) {
            b = demoGetBooking(shopIdProp, trimmedId);
            if (!b) {
              if (!cancelled) {
                setBooking(null);
                setLoadError("mismatch");
              }
            }
          } else {
            b = demoGetBooking(getDefaultShopId(), trimmedId);
            if (!b && !cancelled) {
              setBooking(null);
              setLoadError("not_found");
            }
          }
        }
        if (!cancelled && b) {
          if (shopIdProp && b.shopId !== shopIdProp) {
            setBooking(null);
            setLoadError("mismatch");
          } else {
            setLoadError(null);
            setBooking(b);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const isFs =
            e instanceof Error && e.name === "FirestoreQueryError";
          toast.error(isFs ? e.message : DATA_LOAD_TOAST);
          setLoadError("network");
          setBooking(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, shopIdProp]);

  useEffect(() => {
    return () => {
      revokePreview(localProofPreview);
    };
  }, [localProofPreview, revokePreview]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!shopIdProp) {
        setClientBrandMerge(null);
        return;
      }
      const db = getClientFirestore();
      if (!db || !isFirebaseConfigured()) return;
      let shop;
      try {
        shop = await getShop(db, shopIdProp);
      } catch (e) {
        const isFs =
          e instanceof Error && e.name === "FirestoreQueryError";
        if (!cancelled) {
          toast.error(isFs ? e.message : DATA_LOAD_TOAST);
        }
        return;
      }
      if (cancelled || !shop) return;
      setClientBrandMerge({
        name: shop.name,
        phone: shopWhatsAppNumber(shop),
        upi: shop.upiId ?? "",
      });
    })();
    return () => {
      cancelled = true;
      setClientBrandMerge(null);
    };
  }, [shopIdProp]);

  const upiValue = useMemo(() => {
    if (!booking) return "";
    return buildUpiUri({
      upiId: brand.upi,
      payeeName: brand.name,
      amount: safeBookingAmount(booking.amount),
      transactionNote: `Booking ${booking.id}`,
    });
  }, [booking, brand.name, brand.upi]);

  const gpayValue = useMemo(() => {
    if (!booking) return "";
    return buildGooglePayUri({
      upiId: brand.upi,
      payeeName: brand.name,
      amount: safeBookingAmount(booking.amount),
    });
  }, [booking, brand.name, brand.upi]);

  const copyUpi = async () => {
    if (!hasUpi) return;
    try {
      await navigator.clipboard.writeText(brand.upi);
      toast.success("UPI ID copied", {
        description: `Paste in any UPI app. Pay only to ${brand.upi}.`,
      });
    } catch {
      toast.error("Clipboard blocked");
    }
  };

  const paymentLocked = (s: PaymentStatus) => s === "paid" || s === "cash";

  const markPaid = async () => {
    if (!booking || payBusy || !hasUpi) return;
    if (markPaidInFlight.current) return;
    markPaidInFlight.current = true;
    setPayBusy("paid");
    try {
      const fresh = await verifyBookingForPayment(booking);
      if (!fresh) return;
      const db = getClientFirestore();
      const sid = paymentShopId(fresh, shopIdProp);
      if (db && isFirebaseConfigured()) {
        await updatePaymentStatus(db, sid, fresh.id, "paid");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), fresh.id, {
          paymentStatus: "paid",
        });
      }
      setBooking({ ...fresh, paymentStatus: "paid" });
      setPaidAnim(true);
      toast.success("Payment noted", {
        description: "Desk can verify UPI and confirm on WhatsApp if configured.",
      });
    } catch {
      toast.error(DATA_LOAD_TOAST, {
        action: {
          label: "Retry",
          onClick: () => void markPaid(),
        },
      });
    } finally {
      markPaidInFlight.current = false;
      setPayBusy(null);
    }
  };

  const markCash = async () => {
    if (!booking || payBusy) return;
    setPayBusy("cash");
    const fresh = await verifyBookingForPayment(booking);
    if (!fresh) {
      setPayBusy(null);
      return;
    }
    const db = getClientFirestore();
    try {
      const sid = paymentShopId(fresh, shopIdProp);
      if (db && isFirebaseConfigured()) {
        await updatePaymentStatus(db, sid, fresh.id, "cash");
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), fresh.id, {
          paymentStatus: "cash",
        });
      }
      setBooking({ ...fresh, paymentStatus: "cash" });
      setPaidAnim(true);
      toast.success("Pay at shop saved", {
        description: "Bring the same amount in cash on the day of visit.",
      });
    } catch {
      toast.error(DATA_LOAD_TOAST, {
        action: {
          label: "Retry",
          onClick: () => void markCash(),
        },
      });
    } finally {
      setPayBusy(null);
    }
  };

  const onUpload = async (file: File | null) => {
    if (!file || !booking || !hasUpi) return;
    const fresh = await verifyBookingForPayment(booking);
    if (!fresh) return;
    setUploading(true);
    revokePreview(localProofPreview);
    setLocalProofPreview(null);
    try {
      const storage = getClientStorage();
      let url: string;
      if (storage && isFirebaseConfigured()) {
        url = await uploadPaymentProofImage(storage, fresh.id, file);
      } else {
        url = URL.createObjectURL(file);
        toast.message("Demo mode", {
          description: "Proof preview stays in this browser only.",
        });
      }
      const preview = URL.createObjectURL(file);
      setLocalProofPreview(preview);

      const db = getClientFirestore();
      const sid = paymentShopId(fresh, shopIdProp);
      if (db && isFirebaseConfigured()) {
        await updatePaymentStatus(
          db,
          sid,
          fresh.id,
          "pending_payment",
          url
        );
      } else {
        demoUpdateBooking(sid ?? getDefaultShopId(), fresh.id, {
          paymentStatus: "pending_payment",
          paymentProofUrl: url,
        });
      }
      setBooking({
        ...fresh,
        paymentStatus: "pending_payment",
        paymentProofUrl: url,
      });
      toast.success("Screenshot uploaded", {
        description: "Concierge can review it from the desk.",
      });
    } catch {
      toast.error(DATA_LOAD_TOAST, {
        action: {
          label: "Retry",
          onClick: () => void onUpload(file),
        },
      });
    } finally {
      setUploading(false);
    }
  };

  const showProofImage = Boolean(
    localProofPreview ||
      (booking?.paymentProofUrl &&
        booking.paymentProofUrl.startsWith("blob:"))
  );

  const proofSrc =
    localProofPreview ?? booking?.paymentProofUrl ?? undefined;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-16 lg:px-6">
        <p className="text-center text-sm text-neutral-400">
          Loading booking details...
        </p>
        <div className="h-4 w-40 animate-pulse rounded-full bg-white/10" />
        <div className="h-10 w-2/3 max-w-md animate-pulse rounded-xl bg-white/10" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-3xl bg-white/5" />
          <div className="h-64 animate-pulse rounded-3xl bg-white/5" />
        </div>
      </div>
    );
  }

  if (loadError || !booking) {
    const message =
      loadError === "mismatch"
        ? BOOKING_DATA_MISMATCH_MESSAGE
        : loadError === "network"
          ? DATA_LOAD_TOAST
          : BOOKING_NOT_FOUND_MESSAGE;
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-neutral-400">
        {message}
      </div>
    );
  }

  const locked = paymentLocked(booking.paymentStatus);
  const busyAny = payBusy !== null || uploading;
  const showShopQueryWarning =
    isFirebaseConfigured() && !shopIdProp && Boolean(booking);
  const barberDisplay = formatBookingBarberForDisplay(booking);
  const summaryMeta = [
    booking.date,
    booking.time ? formatClock12(booking.time) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const serviceTitle = booking.serviceName?.trim() || "Service";

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 lg:px-6">
      <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
        Secure checkout
      </p>
      <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">
        Complete payment · {brand.name}
      </h1>
      <p className="mt-3 text-sm text-neutral-400">
        {hasUpi
          ? "UPI is available below. You can still choose pay at shop if you prefer to settle in person."
          : "Payment will be collected at shop. Use Pay at shop below to confirm how you plan to settle."}
      </p>
      {showShopQueryWarning ? (
        <p
          className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          role="status"
        >
          {PAYMENT_SHOP_QUERY_MISSING_MESSAGE}
        </p>
      ) : null}
      {shopIdProp && brand.phone ? (
        <p className="mt-2 text-sm text-neutral-400">
          WhatsApp (shop):{" "}
          <span className="text-neutral-200">
            {formatPhoneDisplay(brand.phone)}
          </span>
        </p>
      ) : null}

      {hasUpi ? (
        <div className="mt-6 rounded-2xl border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-4 py-4 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
              <svg
                className="h-3.5 w-3.5 text-emerald-300"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 5.29a1 1 0 010 1.414l-7.99 8a1 1 0 01-1.415 0l-4-4a1 1 0 111.415-1.414l3.292 3.293 7.283-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Verified UPI
            </span>
          </div>
          <p className="mt-3 font-medium text-white">
            Only pay to this UPI
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Verified ID for this checkout
          </p>
          <p className="mt-2 font-mono text-base text-[#d4af37]">{brand.upi}</p>
          <p className="mt-2 text-xs text-neutral-400">
            Shop:{" "}
            <span className="font-medium text-neutral-200">{brand.name}</span>
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            <span className="font-semibold text-neutral-200">Barber:</span>{" "}
            <span className="font-medium text-neutral-200">
              {barberDisplay}
            </span>
          </p>
          <p className="mt-3 text-xs text-amber-200/90">
            Only pay to this UPI ID. Avoid paying to any other number or unofficial
            QR. If anything looks off, pause and contact the desk before sending
            money.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-[#d4af37]/20 bg-white/[0.04] px-4 py-4 text-sm text-neutral-300">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4af37]/80">
            Checkout
          </p>
          <p className="mt-2 font-serif text-lg text-white">
            Payment will be collected at shop
          </p>
          <p className="mt-2 text-neutral-400">
            Online UPI is not enabled for this site build yet. Bring the booked
            amount on the day of your visit, then tap Pay at shop below to save
            your choice.
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            <span className="font-semibold text-neutral-200">Barber:</span>{" "}
            <span className="font-medium text-neutral-200">
              {barberDisplay}
            </span>
          </p>
        </div>
      )}

      <div
        className={`mt-10 grid gap-8 ${hasUpi ? "lg:grid-cols-[1.1fr_0.9fr]" : ""}`}
      >
        <div className="glass-card rounded-3xl p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Booking summary
          </p>
          <p className="mt-3 font-serif text-xl text-white">{serviceTitle}</p>
          <p className="text-sm text-neutral-400">
            {summaryMeta || "Schedule on file"}
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            <span className="font-semibold text-neutral-200">Barber:</span>{" "}
            <span className="text-neutral-200">{barberDisplay}</span>
          </p>
          <p className="mt-4 text-3xl font-semibold text-[#d4af37]">
            ₹{safeBookingAmount(booking.amount).toLocaleString("en-IN")}
          </p>
          <p className="mt-2 text-xs text-neutral-500">Ref {booking.id}</p>
        </div>

        {hasUpi && upiValue ? (
          <div className="relative flex flex-col items-center overflow-hidden rounded-3xl border border-[#d4af37]/45 bg-gradient-to-b from-[#d4af37]/12 via-transparent to-transparent p-6 shadow-[0_0_56px_rgba(212,175,55,0.22)]">
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">
              Scan to pay
            </p>
            <p className="mt-1 text-center text-sm text-white">{brand.name}</p>
            <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(212,175,55,0.35),0_0_40px_rgba(212,175,55,0.25),0_20px_50px_rgba(0,0,0,0.35)] ring-2 ring-[#d4af37]/60">
              <QRCodeSVG value={upiValue} size={200} includeMargin />
            </div>
            <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row">
              <motion.button
                type="button"
                onClick={copyUpi}
                disabled={busyAny || locked}
                whileHover={{ scale: busyAny || locked ? 1 : 1.02 }}
                whileTap={{ scale: busyAny || locked ? 1 : 0.98 }}
                className="btn-primary min-h-[44px] flex-1 rounded-2xl border border-white/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                Copy UPI ID
              </motion.button>
              <motion.a
                href={gpayValue}
                aria-disabled={busyAny || locked}
                tabIndex={busyAny || locked ? -1 : 0}
                onClick={(e) => {
                  if (busyAny || locked) e.preventDefault();
                }}
                className={`btn-primary flex min-h-[44px] flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-[#0b0b0b] ${
                  busyAny || locked ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Open in Google Pay
              </motion.a>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
          Payment options
        </p>
        <div
          className={`flex flex-col gap-3 ${hasUpi ? "sm:flex-row" : "sm:max-w-md"}`}
        >
          {hasUpi ? (
            <motion.button
              type="button"
              onClick={markPaid}
              disabled={busyAny || locked}
              whileHover={{ scale: busyAny || locked ? 1 : 1.02 }}
              whileTap={{ scale: busyAny || locked ? 1 : 0.98 }}
              className="btn-primary flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#d4af37]/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#d4af37] disabled:opacity-40"
            >
              {payBusy === "paid" ? <Spinner /> : null}
              {payBusy === "paid" ? "Processing..." : "I have paid"}
            </motion.button>
          ) : null}
          <motion.button
            type="button"
            onClick={markCash}
            disabled={busyAny || locked}
            whileHover={{ scale: busyAny || locked ? 1 : 1.02 }}
            whileTap={{ scale: busyAny || locked ? 1 : 0.98 }}
            className="btn-primary flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-200 disabled:opacity-40"
          >
            {payBusy === "cash" ? <Spinner /> : null}
            {payBusy === "cash" ? "Saving…" : "Pay at shop"}
          </motion.button>
        </div>
        <div>
          {hasUpi ? (
            <>
              <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                Optional payment screenshot
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                disabled={busyAny}
                onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-xs text-neutral-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white"
              />
            </>
          ) : (
            <p className="text-xs text-neutral-600">
              Screenshot upload is available when UPI checkout is configured for
              this site.
            </p>
          )}
          {uploading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
              <Spinner className="h-3 w-3" />
              Uploading…
            </p>
          ) : null}
          {showProofImage && proofSrc ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proofSrc}
                alt="Payment proof preview"
                className="max-h-56 w-full object-contain bg-black/40"
              />
            </div>
          ) : null}
          {booking.paymentProofUrl && !showProofImage ? (
            <p className="mt-2 text-[11px] text-neutral-500">
              {booking.paymentProofUrl.startsWith("paymentProofs/")
                ? "Receipt secured for the desk. Concierge opens it from the admin console."
                : "Receipt on file for concierge review."}
            </p>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {paidAnim && (
          <motion.div
            key="paid-banner"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            className="mt-8 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm text-emerald-100"
          >
            Status saved.
            {hasWhatsAppConfigured()
              ? " Concierge will confirm shortly on WhatsApp."
              : " See you at the shop with your booking reference."}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
