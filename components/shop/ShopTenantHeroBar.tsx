"use client";

import { motion } from "framer-motion";
import { formatPhoneDisplay } from "@/config/brand";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { shopWhatsAppNumber } from "@/lib/shops";
import { normalizePhone } from "@/lib/phone";
import type { Shop } from "@/lib/types";

export function ShopTenantHeroBar({ shop }: { shop: Shop }) {
  const digits = shopWhatsAppNumber(shop).replace(/\D/g, "");
  const waHref = buildWhatsAppLink(
    digits,
    `Hi, I'd like to book at ${shop.name}`
  );
  const telDigits = normalizePhone(shop.phone);
  const telHref =
    telDigits.length >= 12 ? `tel:+${telDigits}` : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-card card-hover-depth mb-6 rounded-2xl border border-white/10 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {shop.name}
          </h2>
          {shop.city ? (
            <p className="mt-1 text-sm text-neutral-400">{shop.city}</p>
          ) : null}
          <div className="mt-2 space-y-0.5 text-[11px] text-neutral-500">
            {shop.phone ? (
              <p>
                Phone:{" "}
                <span className="text-neutral-300">
                  {formatPhoneDisplay(shop.phone)}
                </span>
              </p>
            ) : null}
            <p>
              WhatsApp:{" "}
              <span className="text-neutral-300">
                {formatPhoneDisplay(shopWhatsAppNumber(shop))}
              </span>
            </p>
          </div>
          <span className="mt-3 inline-flex items-center rounded-full border border-[#d4af37]/45 bg-[#d4af37]/12 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37]">
            Premium Partner
          </span>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-[#25D366]/45 bg-[#25D366]/15 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-white transition hover:scale-[1.03] active:scale-[0.98]"
          >
            WhatsApp
          </a>
          {telHref ? (
            <a
              href={telHref}
              className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-[#d4af37]/45 bg-[#d4af37]/10 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37] transition hover:scale-[1.03] active:scale-[0.98]"
            >
              Call
            </a>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
