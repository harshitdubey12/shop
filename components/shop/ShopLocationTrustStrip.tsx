"use client";

import type { Shop } from "@/lib/types";

export function ShopLocationTrustStrip({ shop }: { shop: Shop }) {
  if (shop.locationIncomplete) {
    return (
      <p className="mb-4 text-center text-xs text-neutral-500 sm:text-left">
        Location not fully configured
      </p>
    );
  }
  return (
    <p className="mb-4 text-center text-xs font-medium text-[#d4af37]/85 sm:text-left">
      Serving near you
    </p>
  );
}
