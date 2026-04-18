"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { toast } from "sonner";
import {
  getClientAuth,
  getClientFirestore,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import { getShopByOwner, mapShop } from "@/lib/shops";
import type { Shop } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth || !isFirebaseConfigured()) {
      router.replace("/login");
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const db = getClientFirestore();
      if (!db) {
        router.replace("/login");
        return;
      }
      try {
        const s = await getShopByOwner(db, user.uid);
        setShop(s);
      } catch (e) {
        const isFs =
          e instanceof Error && e.name === "FirestoreQueryError";
        toast.error(isFs ? e.message : DATA_LOAD_TOAST);
        setShop(null);
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    const db = getClientFirestore();
    if (!db || !shop?.id) return;
    const ref = doc(db, "shops", shop.id);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      setShop(mapShop(snap.id, snap.data() as Record<string, unknown>));
    });
    return () => unsub();
  }, [shop?.id]);

  if (shop === undefined) {
    return (
      <div className="p-10 text-center text-neutral-400">Loading…</div>
    );
  }

  if (shop === null) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center text-sm text-neutral-400">
        No shop linked to this login yet. Use signup to create a shop first.
      </div>
    );
  }

  return <AdminDashboard shopId={shop.id} shop={shop} />;
}
