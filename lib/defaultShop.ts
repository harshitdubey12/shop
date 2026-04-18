/**
 * Set in .env for `/booking` when the URL has no `/app/[shopId]`.
 * Returns null when unset so the UI can show a configuration message instead of guessing.
 */
export function getConfiguredDefaultShopId(): string | null {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Fallback shop id for demo paths and legacy callers that need a string. */
export function getDefaultShopId(): string {
  return getConfiguredDefaultShopId() ?? "_default";
}
