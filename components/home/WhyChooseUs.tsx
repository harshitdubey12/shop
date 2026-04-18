"use client";

import { WHY_POINTS } from "@/lib/data";
import { motion } from "framer-motion";
import { getBrand } from "@/config/brand";
import { ScrollReveal } from "@/components/ScrollReveal";

export function WhyChooseUs() {
  const brand = getBrand();
  return (
    <section className="border-y border-white/5 bg-gradient-to-b from-black/40 to-transparent py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
                Why {brand.name}
              </p>
              <h2 className="mt-3 max-w-xl font-serif text-3xl text-white sm:text-4xl">
                Details guests notice in the first five minutes
              </h2>
            </div>
            <p className="max-w-md text-sm text-neutral-400">
              We built this studio for people who want quiet focus, predictable
              timing, and barbers who treat hair like industrial design.
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {WHY_POINTS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                delay: i * 0.06,
                duration: 0.6,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="card-hover-depth glass-panel rounded-2xl p-6"
            >
              <div className="flex items-center gap-3">
                <span className="h-px w-10 bg-gradient-to-r from-[#d4af37] to-transparent" />
                <h3 className="font-serif text-lg text-white">{p.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                {p.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
