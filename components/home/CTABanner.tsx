"use client";

import Link from "next/link";
import { getBrand, hasUpiConfigured } from "@/config/brand";
import { ScrollReveal } from "@/components/ScrollReveal";

export function CTABanner({
  bookingHref = "/booking",
}: {
  bookingHref?: string;
}) {
  const brand = getBrand();
  const hasUpi = hasUpiConfigured();

  return (
    <section className="pb-24 lg:pb-32">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <div className="relative overflow-hidden rounded-3xl border border-[#d4af37]/30 bg-gradient-to-r from-[#1a1408] via-[#0b0b0b] to-[#11100a] p-10 text-center sm:p-14">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(212,175,55,0.18),_transparent_55%)]" />
            <p className="relative text-xs uppercase tracking-[0.45em] text-[#d4af37]">
              Limited chairs per hour
            </p>
            <h3 className="relative mt-4 font-serif text-3xl text-white sm:text-4xl">
              Book your slot now. Skip the waiting room chaos.
            </h3>
            <p className="relative mx-auto mt-4 max-w-xl text-sm text-neutral-400">
              Choose your service and lock a time at {brand.name}.
              {hasUpi
                ? " You can pay with UPI after you book, or settle at the shop."
                : " Payment is collected at the shop unless UPI is enabled for this site."}
            </p>
            <div className="relative mt-8 flex justify-center">
              <Link
                href={bookingHref}
                className="btn-ripple inline-flex min-h-[48px] items-center justify-center rounded-full bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-10 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-[#0b0b0b] glow-gold"
              >
                Start booking
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
