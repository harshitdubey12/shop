/**
 * Salon branding and public contact data.
 * Production values must come from NEXT_PUBLIC_* env vars.
 * This module does not invent phone numbers, UPI IDs, or map locations.
 */

export type BrandPublic = {
  name: string;
  tagline: string;
  /** Raw value from NEXT_PUBLIC_WHATSAPP_NUMBER (may include spaces or +). */
  phone: string;
  upi: string;
  addressLine: string;
  hoursLine: string;
  contactLead: string;
  heroIntro: string;
  /** Optional full line for the social strip (e.g. verified stats from the business). */
  socialProofLine: string;
  /** Short trust line above the mobile sticky CTA. */
  mobileTrustLine: string;
};

const FALLBACK = {
  name: "Salon",
  tagline: "Book your visit online.",
} as const;

const NEUTRAL = {
  address: "Visit us at the shop. Full address available at the desk.",
  hours: "Hours posted at the shop and on the door.",
  contactLead: "Visit the studio",
  heroIntro:
    "Senior barbers, calm pacing, and a chair that respects your calendar. Ask at the desk for service details.",
  mobileTrust: "Book online in minutes",
} as const;

/** Client-only merge for multi-tenant shop pages (see ShopHydration). */
let clientBrandMerge: Partial<BrandPublic> | null = null;

export function setClientBrandMerge(merge: Partial<BrandPublic> | null) {
  clientBrandMerge = merge;
}

export function getBrand(): BrandPublic {
  const base: BrandPublic = {
    name: process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || FALLBACK.name,
    tagline:
      process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() || FALLBACK.tagline,
    phone: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || "",
    upi: process.env.NEXT_PUBLIC_UPI_ID?.trim() || "",
    addressLine:
      process.env.NEXT_PUBLIC_BRAND_ADDRESS?.trim() || NEUTRAL.address,
    hoursLine: process.env.NEXT_PUBLIC_BRAND_HOURS?.trim() || NEUTRAL.hours,
    contactLead:
      process.env.NEXT_PUBLIC_BRAND_CONTACT_LEAD?.trim() ||
      NEUTRAL.contactLead,
    heroIntro:
      process.env.NEXT_PUBLIC_BRAND_HERO_INTRO?.trim() || NEUTRAL.heroIntro,
    socialProofLine: process.env.NEXT_PUBLIC_SOCIAL_PROOF_LINE?.trim() || "",
    mobileTrustLine:
      process.env.NEXT_PUBLIC_MOBILE_TRUST_LINE?.trim() || NEUTRAL.mobileTrust,
  };
  if (!clientBrandMerge) return base;
  return { ...base, ...clientBrandMerge };
}

/** Digits only for wa.me (country code, no +). */
export function whatsappDigits(): string {
  return getBrand().phone.replace(/\D/g, "");
}

export function hasWhatsAppConfigured(): boolean {
  const d = whatsappDigits();
  return d.length >= 10 && d.length <= 15;
}

export function hasUpiConfigured(): boolean {
  const u = getBrand().upi.trim();
  return u.length > 3 && u.includes("@");
}

export function hasMapsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_MAPS_QUERY?.trim());
}

export function brandInitials(): string {
  const name = getBrand().name;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]!.charAt(0);
    const b = parts[parts.length - 1]!.charAt(0);
    return (a + b).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "S";
}

/** E.164 style tel: link, or null if the number is not usable. */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `tel:+${digits}`;
  return null;
}

/** Google Maps directions URL, or null when NEXT_PUBLIC_MAPS_QUERY is unset. */
export function mapsDirectionsUrl(): string | null {
  if (!hasMapsConfigured()) return null;
  const raw = process.env.NEXT_PUBLIC_MAPS_QUERY!.trim();
  return `https://www.google.com/maps?q=${encodeURIComponent(raw)}`;
}

/** Embed URL for contact map iframe, or null when maps query is unset. */
export function mapsEmbedUrl(): string | null {
  if (!hasMapsConfigured()) return null;
  const raw = process.env.NEXT_PUBLIC_MAPS_QUERY!.trim();
  return `https://maps.google.com/maps?q=${encodeURIComponent(raw)}&output=embed`;
}

/** Desk display line; never shows a fake subscriber number. */
export function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91"))
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length >= 10 && d.length <= 15) return `+${d}`;
  return "Available at shop";
}
