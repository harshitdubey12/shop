"use client";

import { motion } from "framer-motion";
import { getBrand, hasWhatsAppConfigured, whatsappDigits } from "@/config/brand";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export function WhatsAppFloat() {
  const brand = getBrand();
  if (!hasWhatsAppConfigured()) return null;

  const href = buildWhatsAppLink(
    whatsappDigits(),
    `Hi, I would like to book at ${brand.name}.`
  );

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-5 right-5 z-[55] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-2xl text-white shadow-lg shadow-black/40 md:bottom-6"
      whileHover={{ scale: 1.08, boxShadow: "0 0 32px rgba(37,211,102,0.45)" }}
      whileTap={{ scale: 0.95 }}
      aria-label="Chat on WhatsApp"
    >
      <span aria-hidden>💬</span>
    </motion.a>
  );
}
