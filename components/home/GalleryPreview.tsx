"use client";

import Image from "next/image";
import Link from "next/link";
import { GALLERY_ITEMS } from "@/lib/data";
import { motion } from "framer-motion";
import { ScrollReveal } from "@/components/ScrollReveal";

const preview = GALLERY_ITEMS.slice(0, 6);

export function GalleryPreview() {
  return (
    <section className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <ScrollReveal>
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
                Gallery
              </p>
              <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
                Work that travels on LinkedIn and at dinner
              </h2>
            </div>
            <Link
              href="/gallery"
              className="inline-flex w-fit items-center rounded-full border border-[#d4af37]/40 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#d4af37] transition hover:bg-[#d4af37]/10"
            >
              View full gallery
            </Link>
          </div>
        </ScrollReveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((g, i) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                delay: i * 0.06,
                duration: 0.6,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="card-hover-depth group relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10"
            >
              <Image
                src={g.src}
                alt={g.label}
                fill
                loading="lazy"
                quality={78}
                sizes="(max-width:768px) 100vw, 33vw"
                className="object-cover transition duration-400 ease-out group-hover:scale-105"
              />
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-400 group-hover:bg-black/30" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80 transition group-hover:opacity-100" />
              <p className="absolute bottom-4 left-4 text-sm font-medium text-white">
                {g.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
