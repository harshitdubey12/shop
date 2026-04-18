import type { Shop } from "./types";

export function isShopSubscriptionValid(shop: Shop | null): boolean {
  if (!shop) return false;
  if (!shop.isActive) return false;
  const now = Date.now();
  return shop.expiryDate > now;
}

export const SUBSCRIPTION_BLOCK_MESSAGE =
  "Subscription expired. Contact admin.";
