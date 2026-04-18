"use client";

import { useEffect } from "react";
import { setClientBrandMerge } from "@/config/brand";
import { shopWhatsAppNumber } from "@/lib/shops";
import type { Shop } from "@/lib/types";

export function ShopHydration({ shop }: { shop: Shop | null }) {
  useEffect(() => {
    if (!shop) {
      setClientBrandMerge(null);
      return;
    }
    setClientBrandMerge({
      name: shop.name,
      phone: shopWhatsAppNumber(shop),
      upi: shop.upiId ?? "",
    });
    return () => {
      setClientBrandMerge(null);
    };
  }, [shop]);
  return null;
}
