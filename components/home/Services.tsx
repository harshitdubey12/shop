"use client";

import { SERVICES } from "@/lib/data";
import { motion } from "framer-motion";
import { ScrollReveal } from "@/components/ScrollReveal";

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

export function Services() {
  return (
    <section id="services" className="scroll-mt-28 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
              Menu
            </p>
            <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
              Services crafted like a tasting menu
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-neutral-400 sm:text-base">
              Transparent pricing, no surprise add ons. Every visit includes
              consultation, precision work, and a finishing ritual.
            </p>
          </div>
        </ScrollReveal>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-12 grid gap-8 sm:grid-cols-2 xl:grid-cols-4"
        >
          {SERVICES.map((s) => (
            <motion.article
              key={s.id}
              variants={item}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={`card-hover-depth glass-card group relative overflow-hidden rounded-2xl p-6 hover:glow-gold ${
                s.mostPopular
                  ? "ring-1 ring-[#d4af37]/50 shadow-[0_0_36px_rgba(212,175,55,0.12)]"
                  : ""
              }`}
            >
              {s.mostPopular ? (
                <span className="absolute right-3 top-3 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/15 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#d4af37]">
                  Most popular
                </span>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-2xl text-[#d4af37]">{s.icon}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  {s.durationMins} min
                </span>
              </div>
              <h3 className="mt-5 font-serif text-xl text-white">{s.name}</h3>
              <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                {s.description}
              </p>
              <p className="mt-6 text-2xl font-semibold text-[#d4af37]">
                ₹{s.price.toLocaleString("en-IN")}
              </p>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
