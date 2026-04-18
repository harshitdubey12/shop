"use client";

import { motion } from "framer-motion";
import { getBrand } from "@/config/brand";

function StarRow() {
  return (
    <span className="inline-flex gap-0.5 text-[#d4af37]" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className="h-3.5 w-3.5 fill-current"
          viewBox="0 0 20 20"
          aria-hidden
        >
          <path d="M10 1.5l2.47 5.01L18 7.1l-4 3.9.94 5.5L10 14.9l-4.94 2.6.94-5.5-4-3.9 5.53-.59L10 1.5z" />
        </svg>
      ))}
    </span>
  );
}

export function SocialProofStrip() {
  const brand = getBrand();
  const custom = brand.socialProofLine.trim();

  return (
    <div className="border-y border-white/[0.06] bg-[#0a0a0a]/90">
      <motion.div
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-3.5 text-center sm:gap-x-8 lg:px-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      >
        {custom ? (
          <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-300 sm:text-xs">
            {custom}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-neutral-400 sm:text-xs">
              <StarRow />
              <span>Appointment first studio</span>
            </span>
            <span
              className="hidden h-3 w-px bg-white/15 sm:inline-block"
              aria-hidden
            />
            <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-300 sm:text-xs">
              Personal service at the chair
            </span>
            <span
              className="hidden h-3 w-px bg-white/15 sm:inline-block"
              aria-hidden
            />
            <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 sm:text-xs">
              Ask at desk for walk in availability
            </span>
          </>
        )}
      </motion.div>
    </div>
  );
}
