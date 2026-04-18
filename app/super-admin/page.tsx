"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  getClientAuth,
  getClientFirestore,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { DATA_LOAD_TOAST } from "@/lib/firestoreQuery";
import { mapShop, updateShopFields } from "@/lib/shops";
import {
  clearShopBookingStatsCache,
  getShopBookingStats,
  type ShopBookingStats,
} from "@/lib/shopBookingStats";
import {
  daysRemainingUntilExpiry,
  daysSinceMillis,
  expiryToneClass,
  getExpiryTone,
} from "@/lib/subscriptionDisplay";
import { isShopSubscriptionValid } from "@/lib/subscription";
import { isSuperAdminEmail } from "@/lib/superAdmin";
import type { Shop } from "@/lib/types";

type Phase = "init" | "denied" | "ready" | "noconfig";

function shopLifecycleBadge(s: Shop): {
  label: string;
  className: string;
} {
  if (!s.isActive) {
    return {
      label: "Disabled",
      className:
        "border-red-500/40 bg-red-500/10 text-red-200",
    };
  }
  if (!isShopSubscriptionValid(s)) {
    return {
      label: "Inactive",
      className:
        "border-amber-500/40 bg-amber-500/12 text-amber-100",
    };
  }
  return {
    label: "Active",
    className:
      "border-emerald-500/40 bg-emerald-500/12 text-emerald-100",
  };
}

export default function SuperAdminPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Shop[]>([]);
  const [statsByShop, setStatsByShop] = useState<
    Record<string, ShopBookingStats>
  >({});
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("init");

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setPhase("noconfig");
      return;
    }
    const auth = getClientAuth();
    if (!auth) {
      router.replace("/login");
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!isSuperAdminEmail(user.email)) {
        setPhase("denied");
        return;
      }
      setPhase("ready");
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (phase !== "ready") return;
    const db = getClientFirestore();
    if (!db) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "shops"),
      async (snap) => {
        const list = snap.docs.map((d) =>
          mapShop(d.id, d.data() as Record<string, unknown>)
        );
        setRows(list);
        clearShopBookingStatsCache();
        try {
          const entries = await Promise.all(
            list.map(async (s) => {
              try {
                const st = await getShopBookingStats(db, s.id);
                return [s.id, st] as const;
              } catch {
                return [
                  s.id,
                  { total: null, lastBookingMillis: null },
                ] as const;
              }
            })
          );
          setStatsByShop(Object.fromEntries(entries));
        } catch {
          setStatsByShop({});
        } finally {
          setLoading(false);
        }
      },
      (e) => {
        console.error(e);
        toast.error(DATA_LOAD_TOAST);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [phase]);

  const patchShop = async (shop: Shop, patch: Partial<Shop>) => {
    const db = getClientFirestore();
    if (!db || !isFirebaseConfigured()) return;
    try {
      await updateShopFields(db, shop.id, patch);
      toast.success("Updated");
    } catch (e) {
      const isFs =
        e instanceof Error && e.name === "FirestoreQueryError";
      toast.error(isFs ? e.message : DATA_LOAD_TOAST);
    }
  };

  const extendWeek = (shop: Shop) => {
    const base = Number.isFinite(shop.expiryDate)
      ? shop.expiryDate
      : Date.now();
    const next = base + 7 * 24 * 60 * 60 * 1000;
    void patchShop(shop, { expiryDate: next, isActive: true });
  };

  const logout = async () => {
    const auth = getClientAuth();
    if (auth) await signOut(auth);
    router.replace("/login");
  };

  if (phase === "init") {
    return (
      <div className="p-10 text-center text-neutral-400">Loading…</div>
    );
  }

  if (phase === "noconfig") {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-neutral-400">
        Firebase is not configured. Super admin is unavailable in this build.
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-neutral-400">
        Access denied
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 lg:px-6">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
            Platform
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white">Super admin</h1>
          <p className="mt-1 text-sm text-neutral-500">Shops (live)</p>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="rounded-full bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
        >
          Log out
        </button>
      </div>

      <div className="glass-card mt-8 rounded-2xl border border-[#d4af37]/20 bg-black/30 px-5 py-4 text-sm text-neutral-300">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d4af37]">
          What you can do here
        </p>
        <ul className="mt-3 list-inside space-y-1.5 text-[13px] leading-relaxed">
          <li>
            <span className="text-white">Shop list</span> with city, plan, and
            expiry (updates live from Firestore).
          </li>
          <li>
            <span className="text-white">Booking stats</span> per shop (total
            count and last booking activity).
          </li>
          <li>
            <span className="text-white">Enable / Disable</span> a shop or{" "}
            <span className="text-white">Extend 7 days</span> on subscription.
          </li>
        </ul>
      </div>

      <div className="glass-card mt-8 overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-xs text-neutral-200">
          <thead className="border-b border-[#d4af37]/20 bg-white/[0.06] text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d4af37]/90">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3">Bookings</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : null}
            {!loading &&
              rows.map((s) => {
                const st = statsByShop[s.id];
                const totalFromStats = st?.total ?? null;
                const totalMerged =
                  totalFromStats !== null
                    ? totalFromStats
                    : typeof s.totalBookings === "number" &&
                        Number.isFinite(s.totalBookings)
                      ? s.totalBookings
                      : null;
                const lastMs = st?.lastBookingMillis ?? null;
                const ago = daysSinceMillis(lastMs);
                const inactiveByStale = ago !== null && ago >= 7;
                const noBookingWindow =
                  totalMerged !== null &&
                  (totalMerged === 0 || inactiveByStale);
                const expiryLine = Number.isFinite(s.expiryDate)
                  ? (() => {
                      const dr = daysRemainingUntilExpiry(s.expiryDate);
                      const tone = getExpiryTone(dr);
                      const text =
                        dr < 0
                          ? "Expired"
                          : dr === 0
                            ? "Expires today"
                            : `Expires in ${dr} days`;
                      return { text, cls: expiryToneClass(tone) };
                    })()
                  : null;
                const lastActiveLabel =
                  lastMs != null && ago != null
                    ? `Last active: ${ago} day${ago === 1 ? "" : "s"} ago`
                    : totalMerged === null
                      ? "—"
                      : totalMerged === 0
                        ? "No bookings yet"
                        : "—";
                const life = shopLifecycleBadge(s);
                return (
                  <motion.tr key={s.id} layout className="align-top">
                    <td className="px-4 py-3 text-sm text-white">{s.name}</td>
                    <td className="px-4 py-3">{s.city}</td>
                    <td className="px-4 py-3">{s.plan}</td>
                    <td className="px-4 py-3 text-[11px] text-neutral-400">
                      {Number.isFinite(s.expiryDate) ? (
                        <>
                          <span className="block">
                            {new Date(s.expiryDate).toLocaleString("en-IN")}
                          </span>
                          {expiryLine ? (
                            <span
                              className={`mt-1 block text-[10px] ${expiryLine.cls}`}
                            >
                              {expiryLine.text}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {totalMerged === null ? "—" : totalMerged}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-neutral-400">
                      {lastActiveLabel}
                    </td>
                    <td className="px-4 py-3 text-[11px]">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.1em] ${life.className}`}
                      >
                        {life.label}
                      </span>
                      {noBookingWindow ? (
                        <span className="mt-1 block text-[10px] text-neutral-500">
                          Low activity
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-200"
                          onClick={() =>
                            patchShop(s, { isActive: !s.isActive })
                          }
                        >
                          {s.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-[#d4af37]/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af37]"
                          onClick={() => extendWeek(s)}
                        >
                          Extend 7 days
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
