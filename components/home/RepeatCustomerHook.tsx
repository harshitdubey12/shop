"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ScrollReveal } from "@/components/ScrollReveal";
import { HOME_REBOOK_INTENT } from "@/lib/rebookStorage";

export function RepeatCustomerHook({
  bookingHref = "/booking",
}: {
  bookingHref?: string;
}) {
  return (
    <section className="py-10 lg:py-12">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <motion.div
            className="glass-card relative overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-gradient-to-r from-[#d4af37]/[0.07] via-transparent to-transparent px-6 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-8"
            whileHover={{ scale: 1.005 }}
            transition={{ duration: 0.25 }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#d4af37] via-[#d4af37]/50 to-transparent opacity-70" />
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[#d4af37]">
                Regulars
              </p>
              <p className="mt-2 font-serif text-lg text-white sm:text-xl">
                Become a regular — get priority slots and special offers
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Ask the desk about our return guest list after your first visit.
              </p>
            </div>
            <Link
              href={bookingHref}
              onClick={() => {
                try {
                  sessionStorage.setItem(HOME_REBOOK_INTENT, "1");
                } catch {
                  /* ignore */
                }
              }}
              className="btn-ripple mt-4 inline-flex min-h-[52px] w-full shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-8 py-3.5 text-sm font-bold uppercase tracking-[0.18em] text-[#0b0b0b] shadow-[0_0_28px_rgba(212,175,55,0.22)] transition hover:brightness-105 active:scale-[0.98] sm:mt-0 sm:w-auto sm:min-w-[200px]"
            >
              Book again
            </Link>
          </motion.div>
        </ScrollReveal>
      </div>
    </section>
  );
}
