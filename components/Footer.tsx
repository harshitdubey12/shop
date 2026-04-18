"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  formatPhoneDisplay,
  getBrand,
  hasWhatsAppConfigured,
  mapsDirectionsUrl,
  telHref,
  whatsappDigits,
} from "@/config/brand";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { bookingHrefFromPathname } from "@/lib/tenantBookingLink";

export function Footer() {
  const pathname = usePathname();
  const bookHref = bookingHrefFromPathname(pathname);
  const brand = getBrand();
  const mapsUrl = mapsDirectionsUrl();
  const tel = telHref(brand.phone);
  const waHref = hasWhatsAppConfigured()
    ? buildWhatsAppLink(
        whatsappDigits(),
        `Hi, I would like to book at ${brand.name}.`
      )
    : null;

  return (
    <footer className="border-t border-white/10 bg-black/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-3 lg:px-6">
        <div>
          <p className="font-serif text-2xl text-white">{brand.name}</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-neutral-400">
            {brand.tagline} Appointments only. Walk ins subject to availability.
          </p>
        </div>
        <div className="text-sm text-neutral-300">
          <p className="text-xs uppercase tracking-[0.3em] text-[#d4af37]">
            Visit
          </p>
          <p className="mt-3">{brand.name}</p>
          <p className="text-neutral-500">{brand.addressLine}</p>
          {mapsUrl ? (
            <p className="mt-2">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#d4af37]/90 underline-offset-2 hover:underline"
              >
                Open in Maps
              </a>
            </p>
          ) : (
            <p className="mt-2 text-xs text-neutral-600">
              Location available at shop
            </p>
          )}
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-[#d4af37]">
            Hours
          </p>
          <p className="mt-2 text-neutral-400">{brand.hoursLine}</p>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <Link
            href={bookHref}
            className="inline-flex min-h-[44px] w-fit items-center justify-center rounded-full bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b] transition duration-200 hover:scale-[1.03] active:scale-[0.98]"
          >
            Book appointment
          </Link>
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] w-fit items-center justify-center rounded-full border border-[#d4af37]/40 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#d4af37] transition duration-200 hover:scale-[1.03] active:scale-[0.98]"
            >
              WhatsApp desk
            </a>
          ) : (
            <p className="text-xs text-neutral-600">
              WhatsApp support available at shop
            </p>
          )}
          {tel ? (
            <a
              href={tel}
              className="inline-flex min-h-[44px] text-neutral-400 transition hover:text-white active:scale-[0.97]"
            >
              Call {formatPhoneDisplay(brand.phone)}
            </a>
          ) : (
            <span className="text-neutral-500">
              Call {formatPhoneDisplay(brand.phone)}
            </span>
          )}
        </div>
      </div>
      <div className="border-t border-white/5 py-4 text-center text-[11px] text-neutral-600">
        © {new Date().getFullYear()} {brand.name}. Crafted for guests who value
        time.
      </div>
      <div className="border-t border-white/[0.04] py-3 text-center text-[10px] leading-relaxed text-neutral-600">
        Professional grooming experience powered by modern booking system
      </div>
    </footer>
  );
}
