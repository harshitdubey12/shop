/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBookingStore } from "@/lib/store";
import { useFeePreview, createCheckoutSession, fetchBookingStatus } from "@/lib/api";
import { toast } from "sonner";
import Script from "next/script";
import { HOME_REBOOK_INTENT, saveRebookPayload, rememberLastBookingPhoneForRebook } from "@/lib/rebookStorage";
import { normalizePhone } from "@/lib/phone";
import { formatISODate } from "@/lib/slots";

export default function CheckoutPage() {
  const router = useRouter();
  const { hold_id, hold_expires_at, selected_slot, clearSlotHold } = useBookingStore();
  const [timeLeft, setTimeLeft] = useState<number>(120);
  const [isProcessing, setIsProcessing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);

  // 1. Fee Preview Hook
  const { data: feePreview, isLoading: loadingFee } = useFeePreview(
    selected_slot 
      ? {
          vendor_id: selected_slot.vendor_id,
          service_id: selected_slot.service_id,
          slot_start_unix: selected_slot.slot_start_unix,
        }
      : null
  );

  // 2. Countdown Timer
  useEffect(() => {
    if (!hold_expires_at || confirmedBookingId) return;
    
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = hold_expires_at - now;
      
      if (remaining <= 0) {
        clearInterval(interval);
        setHoldExpired(true);
        clearSlotHold();
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [hold_expires_at, clearSlotHold, confirmedBookingId]);

  // If no hold exists and not confirmed, redirect back
  useEffect(() => {
    if (!hold_id && !confirmedBookingId && !holdExpired) {
      router.back();
    }
  }, [hold_id, confirmedBookingId, holdExpired, router]);

  // 3. Payment Handler
  const handlePayment = async () => {
    if (!hold_id || !feePreview) return;
    setIsProcessing(true);
    setPaymentFailed(false);
    
    try {
      const { razorpay_order_id, booking_id, razorpay_key } = await createCheckoutSession({
        hold_id,
        expected_price_paise: feePreview.total_amount_paise,
      });

      const customerName = sessionStorage.getItem("checkout_customer_name") || "Guest";
      const customerPhone = sessionStorage.getItem("checkout_customer_phone") || "";

      const options = {
        key: razorpay_key,
        amount: feePreview.platform_fee_paise,
        currency: "INR",
        name: "Barber Booking",
        description: "Platform Booking Fee",
        order_id: razorpay_order_id,
        handler: async function (response: any) {
          setVerifying(true);
          
          let attempts = 0;
          const pollInterval = setInterval(async () => {
            attempts++;
            try {
              const statusData = await fetchBookingStatus(booking_id);
              if (statusData.lifecycle_status === "confirmed" || statusData.lifecycle_status === "completed") {
                clearInterval(pollInterval);
                setVerifying(false);
                setConfirmedBookingId(booking_id);
                clearSlotHold();
              }
            } catch (err) {
              console.error("Polling error", err);
            }
            if (attempts > 10) {
              clearInterval(pollInterval);
              setVerifying(false);
              toast.error("Payment received, but verification timed out. We will confirm shortly.");
            }
          }, 3000);
        },
        prefill: {
          name: customerName,
          contact: customerPhone,
        },
        theme: { color: "#d4af37" },
        modal: {
          ondismiss: function () {
            setIsProcessing(false);
            setPaymentFailed(true);
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (response: any) {
        setIsProcessing(false);
        setPaymentFailed(true);
        toast.error(`Payment Failed: ${response.error.description}`);
      });
      rzp.open();

    } catch (err) {
      setIsProcessing(false);
      setPaymentFailed(true);
      toast.error("Failed to initiate checkout. Please try again.");
    }
  };

  const handleRebook = () => {
    if (!selected_slot) return;
    const phone = sessionStorage.getItem("checkout_customer_phone") || "";
    const name = sessionStorage.getItem("checkout_customer_name") || "";
    
    // Convert slot_start_unix to isoDate and time
    const d = new Date(selected_slot.slot_start_unix * 1000);
    const isoDate = formatISODate(d.getFullYear(), d.getMonth(), d.getDate());
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    saveRebookPayload(selected_slot.vendor_id, {
      serviceId: selected_slot.service_id,
      time,
      customerName: name,
      customerPhone: normalizePhone(phone),
      lastVisitDate: isoDate,
    });
    rememberLastBookingPhoneForRebook(selected_slot.vendor_id, phone);
    sessionStorage.setItem(HOME_REBOOK_INTENT, "1");
    router.push(`/app/${selected_slot.vendor_id}/booking`);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // UI: Expiration Fallback State
  if (holdExpired) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 lg:px-6 lg:py-28 text-center">
        <div className="glass-card rounded-3xl p-8 border border-red-500/30">
          <h1 className="text-2xl font-serif text-white mb-2">Slot Hold Expired</h1>
          <p className="text-neutral-400 mb-6">Your 120-second hold has elapsed. The slot has been released.</p>
          <button 
            onClick={() => router.push(`/app/${selected_slot?.vendor_id || ''}/booking`)}
            className="btn-primary w-full rounded-2xl bg-white/10 py-3.5 text-sm font-bold uppercase tracking-widest text-white hover:bg-white/20"
          >
            Find Alternative Slots
          </button>
        </div>
      </div>
    );
  }

  // UI: Post-Booking Success State
  if (confirmedBookingId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 lg:px-6 lg:py-28 text-center">
        <div className="glass-card rounded-3xl p-8 border border-emerald-500/30 glow-emerald">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 mb-4">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-3xl font-serif text-white mb-2">Booking Confirmed!</h1>
          <p className="text-neutral-400 mb-4">Your chair is reserved. See you soon.</p>
          
          <div className="bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-2xl p-4 mb-6 text-sm">
            <div className="flex items-center justify-center gap-2 text-[#d4af37] font-bold mb-1">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" /><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" /></svg>
              10 Loyalty Points Earned
            </div>
            <p className="text-neutral-300 text-xs">Use these on your next booking.</p>
          </div>

          <div className="flex flex-col gap-3">
            <button 
              onClick={handleRebook}
              className="btn-primary w-full rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] py-3.5 text-sm font-bold uppercase tracking-[0.2em] text-[#0b0b0b]"
            >
              Book Again
            </button>
            <button 
              onClick={() => router.push(`/app/${selected_slot?.vendor_id || ''}`)}
              className="btn-primary w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 text-sm font-bold uppercase tracking-[0.2em] text-neutral-300 hover:bg-white/10"
            >
              Back to Shop
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!hold_id) return null;

  const timerProgress = (timeLeft / 120) * 100;
  const isUrgent = timeLeft <= 30;

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="mx-auto max-w-xl px-4 py-20 lg:px-6 lg:py-28">
        <div className="glass-card rounded-3xl p-6 sm:p-8 border border-[#d4af37]/20 relative overflow-hidden">
          
          <div className="absolute top-0 left-0 w-full h-1 bg-white/10">
            <div 
              className={`h-full transition-all duration-1000 ${isUrgent ? 'bg-red-500' : 'bg-[#d4af37]'}`}
              style={{ width: `${timerProgress}%` }}
            />
          </div>

          <div className="flex justify-between items-center mb-2 mt-2">
            <h1 className="text-2xl font-serif text-white">Checkout</h1>
            <div className={`text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border ${isUrgent ? 'bg-red-500/10 text-red-400 border-red-500/30 animate-pulse' : 'bg-amber-500/10 text-amber-200 border-amber-500/30'}`}>
              {formatTime(timeLeft)}
            </div>
          </div>
          <p className="text-xs text-neutral-400 mb-6">Slot reserved for you. Complete payment to secure.</p>

          {loadingFee ? (
            <div className="py-10 text-center text-neutral-400">Calculating fees...</div>
          ) : feePreview ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/5 bg-black/40 p-5">
                <div className="flex justify-between text-sm text-neutral-300 mb-3">
                  <span>Service Base Price</span>
                  <span>₹{(feePreview.service_price_paise / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-neutral-300 mb-3 border-b border-white/10 pb-3">
                  <div className="flex flex-col">
                    <span className="text-white">₹{(feePreview.platform_fee_paise / 100).toFixed(2)} Platform Fee</span>
                    <span className="text-[10px] text-[#d4af37] mt-0.5">Guaranteed slot + reminders + support</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm text-neutral-300 mb-4 pb-4 border-b border-white/10">
                  <span>Taxes</span>
                  <span>₹{(feePreview.tax_paise / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold text-[#d4af37]">
                  <span>Total Amount</span>
                  <span>₹{(feePreview.total_amount_paise / 100).toFixed(2)}</span>
                </div>
              </div>

              {paymentFailed && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200/90 text-center mb-4">
                  Payment failed or was cancelled. Please try again.
                </div>
              )}

              <button
                onClick={handlePayment}
                disabled={isProcessing || verifying}
                className="w-full mt-6 flex items-center justify-center rounded-2xl bg-[#d4af37] py-4 text-sm font-bold uppercase tracking-widest text-black disabled:opacity-50 transition hover:bg-[#eadd87]"
              >
                {verifying ? "Verifying Payment..." : paymentFailed ? "Retry Payment" : `Pay ₹${(feePreview.platform_fee_paise / 100).toFixed(2)}`}
              </button>
            </div>
          ) : (
            <div className="py-10 text-center text-red-400">Failed to load fee preview.</div>
          )}
        </div>
      </div>
    </>
  );
}
