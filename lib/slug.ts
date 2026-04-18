/** URL-safe shop id from display name (slug). */
export function slugifyShopName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shop";
}

export function uniqueShopId(baseSlug: string, suffix: string): string {
  const s = slugifyShopName(baseSlug);
  return `${s}-${suffix.slice(0, 8)}`;
}
