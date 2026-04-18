/**
 * Strip non-digits, normalize Indian mobile to exactly 12 digits: 91 + 10 digits (first digit 6–9).
 * Returns "" when the number cannot be mapped to that format (safe for matching and storage).
 */
export function normalizePhone(phone: string): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";

  while (d.startsWith("0") && d.length > 10) {
    d = d.slice(1);
  }

  if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) {
    return `91${d}`;
  }

  if (d.length === 12 && /^91[6-9]\d{9}$/.test(d)) {
    return d;
  }

  if (d.length > 12 || (d.length >= 11 && !/^91[6-9]\d{9}$/.test(d))) {
    const last10 = d.slice(-10);
    if (/^[6-9]\d{9}$/.test(last10)) {
      return `91${last10}`;
    }
  }

  return "";
}

/**
 * Query keys that may exist in Firestore for the same handset (legacy 10-digit vs canonical 12-digit).
 */
export function phoneQueryVariantsFromRaw(raw: string): string[] {
  const n = normalizePhone(raw);
  if (!n || n.length !== 12) return [];
  const s = new Set<string>([n]);
  s.add(n.slice(-10));
  return [...s].filter((v) => v.length >= 10);
}

/** Last 10 digits for legacy rows stored without country code (91…). */
export function legacyTenDigitFromCanonical(canonical12: string): string | null {
  if (canonical12.length !== 12) return null;
  const t = canonical12.slice(-10);
  return /^[0-9]{10}$/.test(t) ? t : null;
}

/**
 * @deprecated Same as normalizePhone; kept for older imports.
 */
export function normalizePhoneKey(raw: string): string {
  return normalizePhone(raw);
}
