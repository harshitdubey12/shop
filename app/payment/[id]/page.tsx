"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PaymentClient } from "@/components/payment/PaymentClient";
import { BOOKING_NOT_FOUND_MESSAGE } from "@/lib/configMessages";

function PaymentRouteInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawId = params?.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const shopRaw = searchParams.get("shop");
  const shop =
    typeof shopRaw === "string" && shopRaw.length > 0 ? shopRaw : undefined;

  if (!id) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-neutral-400">
        {BOOKING_NOT_FOUND_MESSAGE}
      </div>
    );
  }

  return <PaymentClient id={id} shopId={shop} />;
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-sm text-neutral-400">
          Loading booking details...
        </div>
      }
    >
      <PaymentRouteInner />
    </Suspense>
  );
}
