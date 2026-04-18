"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  formatPhoneDisplay,
  getBrand,
  mapsDirectionsUrl,
  telHref,
} from "@/config/brand";

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
    </svg>
  );
}

export function Hero({
  bookingHref = "/booking",
}: {
  bookingHref?: string;
}) {
  const brand = getBrand();
  const dot = brand.tagline.indexOf(".");
  const head = dot === -1 ? "" : brand.tagline.slice(0, dot).trim();
  const tail =
    dot === -1 ? brand.tagline.trim() : brand.tagline.slice(dot + 1).trim();
  const mapsUrl = mapsDirectionsUrl();
  const tel = telHref(brand.phone);
  const phoneLabel = formatPhoneDisplay(brand.phone);
  const mapsTitle =
    "Directions unlock when NEXT_PUBLIC_MAPS_QUERY is set in deployment env";

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      <Image
        src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=2000&q=80"
        alt={`${brand.name} interior`}
        fill
        priority
        quality={82}
        sizes="100vw"
        className="object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.95))",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-4 pb-28 pt-28 lg:px-6 lg:pb-32 lg:pt-32">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-xs uppercase tracking-[0.45em] text-[#d4af37]"
        >
          {brand.name}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="mt-5 max-w-3xl font-serif text-3xl font-bold leading-[1.05] text-white md:text-6xl md:leading-[1.05]">
            {head ? (
              <>
                {head}.{" "}
              </>
            ) : null}
            <span className="gold-gradient-text">{tail}</span>
          </h1>
          <div
            className="mt-5 h-1 w-28 max-w-[40%] rounded-full md:mt-6 md:w-40"
            style={{
              background:
                "linear-gradient(90deg, rgba(212,175,55,0.2), #d4af37, rgba(212,175,55,0.2))",
            }}
          />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.12 }}
          className="mt-6 max-w-xl text-sm leading-relaxed text-neutral-300 sm:text-base"
        >
          {brand.heroIntro}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.18 }}
          className="mt-8 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href={bookingHref}
              className="btn-primary btn-ripple inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-8 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#0b0b0b] glow-gold active:scale-[0.97]"
            >
              Book Appointment
            </Link>
            {tel ? (
              <a
                href={tel}
                className="btn-ripple inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-white/20 px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white transition duration-300 hover:border-[#d4af37]/50 hover:text-[#d4af37] active:scale-[0.97]"
              >
                <PhoneIcon className="h-4 w-4 text-[#d4af37]" />
                Call {phoneLabel}
              </a>
            ) : (
              <span className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 px-6 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Call {phoneLabel}
              </span>
            )}
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ripple inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-white/20 px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-neutral-200 transition duration-300 hover:border-[#d4af37]/45 hover:text-white active:scale-[0.97]"
              >
                <PinIcon className="h-4 w-4 text-[#d4af37]" />
                Get directions
              </a>
            ) : (
              <span
                title={mapsTitle}
                className="inline-flex min-h-[44px] cursor-default flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/10 px-5 py-2.5 text-center sm:flex-row sm:gap-2"
              >
                <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                  <PinIcon className="h-4 w-4 text-neutral-600" />
                  Location
                </span>
                <span className="text-[10px] font-normal normal-case tracking-normal text-neutral-600">
                  available at shop
                </span>
              </span>
            )}
          </div>
          <Link
            href="/#services"
            className="inline-flex w-fit items-center justify-center rounded-2xl border border-white/15 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-300 transition duration-300 hover:border-[#d4af37]/50 hover:text-white active:scale-[0.97]"
          >
            View services
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
