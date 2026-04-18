"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getBrand } from "@/config/brand";

const ROUTE_MS = 480;

export function RouteTransitionLoader() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const first = useRef(true);
  const brand = getBrand();

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShow(true);
    const t = window.setTimeout(() => setShow(false), ROUTE_MS);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center bg-[#0b0b0b]/94 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="pointer-events-none flex flex-col items-center gap-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#d4af37]/40 bg-[#0b0b0b]"
              animate={{
                boxShadow: [
                  "0 0 0 1px rgba(212,175,55,0.2)",
                  "0 0 28px rgba(212,175,55,0.28)",
                  "0 0 0 1px rgba(212,175,55,0.2)",
                ],
              }}
              transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            >
              <motion.span
                className="absolute inset-1.5 rounded-full border-2 border-transparent border-t-[#d4af37]"
                animate={{ rotate: 360 }}
                transition={{
                  repeat: Infinity,
                  duration: 0.85,
                  ease: "linear",
                }}
              />
            </motion.div>
            <p className="font-serif text-lg text-white">{brand.name}</p>
            <div className="h-px w-32 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-1/2 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent"
                animate={{ x: ["-100%", "200%"] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.2,
                  ease: "linear",
                }}
              />
            </div>
          </motion.div>
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-px overflow-hidden bg-white/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#d4af37]/80 to-transparent"
              animate={{ x: ["-100%", "400%"] }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                ease: "linear",
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
