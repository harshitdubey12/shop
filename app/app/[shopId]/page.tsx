"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { HomePageSections } from "@/components/home/HomePageSections";
import { ShopLocationTrustStrip } from "@/components/shop/ShopLocationTrustStrip";
import { ShopTenantHeroBar } from "@/components/shop/ShopTenantHeroBar";
import { ShopHydration } from "@/components/ShopHydration";
import { getClientFirestore, isFirebaseConfigured } from "@/lib/firebase";
import { getShop } from "@/lib/shops";
import type { Shop } from "@/lib/types";

export default function TenantHomePage() {
  const params = useParams();
  const shopId = typeof params?.shopId === "string" ? params.shopId : "";
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);

  useEffect(() => {
    if (!shopId) {
      setShop(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      if (!db || !isFirebaseConfigured()) {
        if (!cancelled) setShop(null);
        return;
      }
      const s = await getShop(db, shopId);
      if (!cancelled) setShop(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  if (shop === undefined) {
    return (
      <div className="p-10 text-center text-neutral-400">Loading…</div>
    );
  }

  if (shop === null) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-neutral-400">
        Shop not found.
      </div>
    );
  }

  return (
    <>
      <ShopHydration shop={shop} />
      <div className="mx-auto max-w-5xl px-4 pt-8 lg:px-6">
        <ShopTenantHeroBar shop={shop} />
        <ShopLocationTrustStrip shop={shop} />
      </div>
      <HomePageSections tenantShopId={shop.id} />
    </>
  );
}
