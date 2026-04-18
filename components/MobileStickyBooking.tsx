"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  formatPhoneDisplay,
  getBrand,
  mapsDirectionsUrl,
  telHref,
} from "@/config/brand";
import { usePathname } from "next/navigation";
import { bookingHrefFromPathname } from "@/lib/tenantBookingLink";

export function MobileStickyBooking() {
  const pathname = usePathname();
  const bookHref = bookingHrefFromPathname(pathname);
  const brand = getBrand();
  const tel = telHref(brand.phone);
  const phoneShort = formatPhoneDisplay(brand.phone);
  const mapsUrl = mapsDirectionsUrl();
  const mapsTitle =
    "Directions unlock when NEXT_PUBLIC_MAPS_QUERY is set in deployment env";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 md:hidden">
      <div className="pointer-events-auto border-t border-white/10 bg-[#0b0b0b]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
        <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">
          {brand.mobileTrustLine}
        </p>
        <div className="mb-2 grid grid-cols-2 gap-2">
          {tel ? (
            <a
              href={tel}
              className="btn-ripple flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition active:scale-[0.97]"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 text-[#d4af37]"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
              Call
            </a>
          ) : (
            <span className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
              Call at shop
            </span>
          )}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ripple flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-200 transition active:scale-[0.97]"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 text-[#d4af37]"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M10 18s6-4.686 6-10A6 6 0 104 8c0 5.314 6 10 6 10zm0-8a2 2 0 100-4 2 2 0 000 4z"
                  clipRule="evenodd"
                />
              </svg>
              Map
            </a>
          ) : (
            <span
              title={mapsTitle}
              className="flex min-h-[44px] cursor-default flex-col items-center justify-center rounded-xl border border-white/10 py-2 px-1 text-center text-[9px] font-medium uppercase leading-tight tracking-[0.08em] text-neutral-500"
            >
              <span>Location</span>
              <span className="mt-0.5 font-normal normal-case tracking-normal text-neutral-600">
                at shop
              </span>
            </span>
          )}
        </div>
        <p className="mb-1.5 text-center text-[10px] text-neutral-600">
          {brand.name} · {phoneShort}
        </p>
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          <Link
            href={bookHref}
            className="btn-primary btn-ripple flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-5 py-3.5 text-base font-semibold text-[#0b0b0b] glow-gold"
          >
            Book Appointment
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
