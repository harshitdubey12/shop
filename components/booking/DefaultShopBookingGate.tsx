"use client";

import { useEffect, useState } from "react";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { getDefaultShopId } from "@/lib/defaultShop";
import { getClientFirestore, isFirebaseConfigured } from "@/lib/firebase";
import { getShop } from "@/lib/shops";
import type { Shop } from "@/lib/types";

/**
 * `/booking` uses the env default shop id when set; otherwise `_default` so the
 * wizard can run locally with demo storage when Firebase is not configured.
 */
export function DefaultShopBookingGate() {
  const shopIdForRoute = getDefaultShopId();
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [shop, setShop] = useState<Shop | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getClientFirestore();
      if (!db || !isFirebaseConfigured()) {
        if (!cancelled) {
          setShop(null);
          setPhase("ready");
        }
        return;
      }
      try {
        const s = await getShop(db, shopIdForRoute);
        if (cancelled) return;
        setShop(s);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setShop(null);
          setPhase("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopIdForRoute]);

  if (phase === "loading") {
    return (
      <div className="p-10 text-center text-neutral-400">Loading…</div>
    );
  }

  return <BookingWizard shopId={shopIdForRoute} shop={shop} />;
}
