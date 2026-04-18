"use client";

import { useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { GALLERY_ITEMS } from "@/lib/data";
import { ScrollReveal } from "@/components/ScrollReveal";

type Cat = "all" | "haircut" | "beard" | "before_after" | "salon";

const chips: { id: Cat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "haircut", label: "Haircut" },
  { id: "beard", label: "Beard" },
  { id: "before_after", label: "Before / After" },
  { id: "salon", label: "Studio" },
];

export function GalleryMasonry() {
  const [cat, setCat] = useState<Cat>("all");
  const [active, setActive] = useState<(typeof GALLERY_ITEMS)[number] | null>(
    null
  );
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const markLoaded = useCallback((id: string) => {
    setLoaded((prev) => ({ ...prev, [id]: true }));
  }, []);

  const items = useMemo(() => {
    if (cat === "all") return GALLERY_ITEMS;
    return GALLERY_ITEMS.filter((g) => g.category === cat);
  }, [cat]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 lg:px-6">
      <ScrollReveal>
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
            Gallery
          </p>
          <h1 className="mt-3 font-serif text-4xl text-white sm:text-5xl">
            Frames from the floor
          </h1>
          <p className="mt-4 text-sm text-neutral-400">
            Every image is from our artists in chair. Tap any tile for a larger
            look.
          </p>
        </div>
      </ScrollReveal>

      <div className="mt-8 flex flex-wrap gap-2">
        {chips.map((c) => (
          <motion.button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
              cat === c.id
                ? "bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] text-[#0b0b0b]"
                : "border border-white/10 text-neutral-300 hover:border-[#d4af37]/40"
            }`}
          >
            {c.label}
          </motion.button>
        ))}
      </div>

      <div className="masonry mt-10">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-16 text-center">
            <p className="font-serif text-xl text-white">Photos will be added soon</p>
            <p className="mt-2 text-sm text-neutral-500">
              Check back shortly for fresh cuts and studio shots.
            </p>
          </div>
        ) : null}
        {items.map((g, i) => (
          <motion.button
            type="button"
            key={g.id}
            layout
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{
              delay: (i % 6) * 0.05,
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1],
            }}
            onClick={() => setActive(g)}
            className="card-hover-depth masonry-item group relative w-full overflow-hidden rounded-2xl border border-white/10 text-left"
          >
            <div className="relative aspect-[3/4] w-full">
              {!loaded[g.id] && (
                <div className="absolute inset-0 z-[1] animate-pulse bg-neutral-800" />
              )}
              <Image
                src={g.src}
                alt={g.label}
                fill
                loading="lazy"
                quality={76}
                sizes="(max-width:768px) 100vw, 33vw"
                onLoadingComplete={() => markLoaded(g.id)}
                className={`object-cover transition duration-400 ease-out group-hover:scale-105 ${
                  loaded[g.id] ? "opacity-100" : "opacity-0"
                }`}
              />
              <div className="absolute inset-0 bg-black/0 transition duration-400 group-hover:bg-black/30" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80 transition group-hover:opacity-100" />
              <p className="absolute bottom-3 left-3 text-sm text-white">
                {g.label}
              </p>
            </div>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActive(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0b]"
            >
              <button
                type="button"
                className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.16em] text-white"
                onClick={() => setActive(null)}
              >
                Close
              </button>
              <div className="relative aspect-[4/5] w-full">
                <Image
                  src={active.src}
                  alt={active.label}
                  fill
                  quality={80}
                  loading="lazy"
                  className="object-cover"
                  sizes="100vw"
                />
              </div>
              <div className="border-t border-white/10 p-4 text-sm text-neutral-200">
                {active.label}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
