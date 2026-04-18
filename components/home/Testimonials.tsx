"use client";

import { TESTIMONIALS } from "@/lib/data";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ScrollReveal } from "@/components/ScrollReveal";

export function Testimonials() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((v) => (v + 1) % TESTIMONIALS.length),
      5200
    );
    return () => window.clearInterval(id);
  }, []);

  const active = TESTIMONIALS[index]!;

  return (
    <section className="py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
              Voices
            </p>
            <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
              Guests who treat grooming like part of their brand
            </h2>
          </div>
        </ScrollReveal>

        <ScrollReveal className="mt-12" delay={0.08}>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-8 sm:p-12">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#d4af37]/15 blur-3xl" />
          <AnimatePresence mode="wait">
            <motion.div
              key={active.name}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45 }}
              className="relative max-w-3xl"
            >
              <p className="font-serif text-2xl leading-snug text-white sm:text-3xl">
                “{active.quote}”
              </p>
              <div className="mt-8 flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#f3e2ad] via-[#d4af37] to-[#8a6d3b]" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {active.name}
                  </p>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                    {active.role}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-10 flex gap-2">
            {TESTIMONIALS.map((t, i) => (
              <button
                key={t.name}
                type="button"
                aria-label={`Show testimonial ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 flex-1 rounded-full transition ${
                  i === index ? "bg-[#d4af37]" : "bg-white/10"
                }`}
              />
            ))}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
