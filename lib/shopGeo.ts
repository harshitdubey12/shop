import type { Shop } from "./types";

/** True when the shop has usable coordinates for distance and nearby routing. */
export function isShopLocationComplete(shop: Shop | null): boolean {
  if (!shop) return false;
  if (shop.locationIncomplete) return false;
  if (!Number.isFinite(shop.lat) || !Number.isFinite(shop.lng)) return false;
  if (shop.lat === 0 && shop.lng === 0) return false;
  return true;
}
