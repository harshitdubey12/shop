"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getBrand } from "@/config/brand";

const DISPLAY_MS = 1280;

function ShimmerLine() {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden bg-white/10">
      <motion.div
        className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent"
        initial={{ x: "-100%" }}
        animate={{ x: "400%" }}
        transition={{
          repeat: Infinity,
          duration: 1.8,
          ease: "linear",
        }}
      />
    </div>
  );
}

export function PageLoader() {
  const [visible, setVisible] = useState(true);
  const brand = getBrand();

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0b0b]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <ShimmerLine />
          <div className="relative flex flex-col items-center gap-8 px-6 text-center">
            <motion.div
              className="relative"
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.div
                className="absolute inset-[-18px] rounded-full bg-[#d4af37]/20 blur-xl"
                animate={{ opacity: [0.35, 0.65, 0.35], scale: [0.92, 1.05, 0.92] }}
                transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
              />
              <motion.div
                className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[#d4af37]/50 bg-[#0b0b0b]"
                animate={{
                  boxShadow: [
                    "0 0 0 1px rgba(212,175,55,0.25)",
                    "0 0 32px rgba(212,175,55,0.35)",
                    "0 0 0 1px rgba(212,175,55,0.25)",
                  ],
                }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              >
                <motion.span
                  className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#d4af37] border-r-[#d4af37]/30"
                  animate={{ rotate: 360 }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.1,
                    ease: "linear",
                  }}
                />
                <span className="relative z-[1] font-serif text-xl font-semibold tracking-wide text-[#d4af37]">
                  {brand.name.slice(0, 2).toUpperCase()}
                </span>
              </motion.div>
            </motion.div>
            <div>
              <motion.p
                className="font-serif text-2xl tracking-tight text-white sm:text-3xl"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.5 }}
              >
                {brand.name}
              </motion.p>
              <motion.p
                className="mt-3 text-[11px] uppercase tracking-[0.45em] text-neutral-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.28, duration: 0.45 }}
              >
                Preparing your suite
              </motion.p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
