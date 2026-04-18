"use client";

import {
  formatPhoneDisplay,
  getBrand,
  mapsDirectionsUrl,
  mapsEmbedUrl,
  telHref,
  hasWhatsAppConfigured,
  whatsappDigits,
} from "@/config/brand";
import { ScrollReveal } from "@/components/ScrollReveal";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export function ContactMap() {
  const brand = getBrand();
  const mapsUrl = mapsDirectionsUrl();
  const embed = mapsEmbedUrl();
  const tel = telHref(brand.phone);
  const waHref = hasWhatsAppConfigured()
    ? buildWhatsAppLink(
        whatsappDigits(),
        `Hi, I would like to visit ${brand.name}.`
      )
    : null;
  const mapsTitle =
    "Directions unlock when NEXT_PUBLIC_MAPS_QUERY is set in deployment env";

  return (
    <section id="contact" className="border-t border-white/10 pb-28">
      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <ScrollReveal>
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-[#d4af37]">
                Visit the studio
              </p>
              <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
                {brand.contactLead}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-neutral-400">
                {brand.addressLine}
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                Desk {formatPhoneDisplay(brand.phone)}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {tel ? (
                  <a
                    href={tel}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/15 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition duration-200 hover:scale-[1.03] hover:border-[#d4af37]/60 hover:shadow-[0_0_24px_rgba(212,175,55,0.1)] active:scale-[0.97]"
                  >
                    Call desk
                  </a>
                ) : (
                  <span className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/10 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    Call available at shop
                  </span>
                )}
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-200 transition duration-200 hover:scale-[1.03] hover:border-[#d4af37]/45 hover:text-white active:scale-[0.97]"
                  >
                    <svg
                      className="h-3.5 w-3.5 text-[#d4af37]"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18s6-4.686 6-10A6 6 0 104 8c0 5.314 6 10 6 10zm0-8a2 2 0 100-4 2 2 0 000 4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Get directions
                  </a>
                ) : (
                  <span
                    title={mapsTitle}
                    className="inline-flex min-h-[44px] cursor-default flex-col items-center justify-center gap-0.5 rounded-full border border-white/10 px-5 py-2.5 text-center sm:flex-row sm:gap-2"
                  >
                    <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                      <svg
                        className="h-3.5 w-3.5 text-neutral-600"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18s6-4.686 6-10A6 6 0 104 8c0 5.314 6 10 6 10zm0-8a2 2 0 100-4 2 2 0 000 4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Location
                    </span>
                    <span className="text-[10px] font-normal normal-case tracking-normal text-neutral-600">
                      available at shop
                    </span>
                  </span>
                )}
                {waHref ? (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[#25D366] px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition duration-200 hover:scale-[1.03] active:scale-[0.97]"
                  >
                    WhatsApp priority lane
                  </a>
                ) : null}
              </div>
              {!waHref ? (
                <p className="mt-3 text-xs text-neutral-600">
                  WhatsApp support available at shop
                </p>
              ) : null}
            </div>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="glass-panel overflow-hidden rounded-3xl border border-white/10">
              {embed ? (
                <iframe
                  title="Studio location"
                  src={embed}
                  width="100%"
                  height="320"
                  loading="lazy"
                  className="border-0"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-[320px] flex-col items-center justify-center gap-2 bg-black/40 px-6 text-center text-sm text-neutral-500">
                  <p>Location available at shop</p>
                  <p className="text-xs text-neutral-600">
                    Map preview appears when NEXT_PUBLIC_MAPS_QUERY is set for
                    your studio address.
                  </p>
                </div>
              )}
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
