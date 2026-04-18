"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { ShopHydration } from "@/components/ShopHydration";
import { getClientFirestore, isFirebaseConfigured } from "@/lib/firebase";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import { getShop } from "@/lib/shops";
import type { Shop } from "@/lib/types";

function TenantBookingInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const shopId = typeof params?.shopId === "string" ? params.shopId : "";
  const initialTime = searchParams.get("time");
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
      try {
        const s = await getShop(db, shopId);
        if (!cancelled) setShop(s);
      } catch (e) {
        const isFs =
          e instanceof Error && e.name === "FirestoreQueryError";
        if (!cancelled) {
          toast.error(isFs ? e.message : DATA_LOAD_TOAST);
          setShop(null);
        }
      }
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
      <BookingWizard
        shopId={shopId}
        shop={shop}
        initialTime={initialTime}
      />
    </>
  );
}

export default function TenantBookingPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-neutral-400">Loading…</div>
      }
    >
      <TenantBookingInner />
    </Suspense>
  );
}
