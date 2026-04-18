"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { toast } from "sonner";
import { getClientAuth, getClientFirestore, isFirebaseConfigured } from "@/lib/firebase";
import { createShopDocument, ensureUserProfile } from "@/lib/shops";
import { normalizePhone } from "@/lib/phone";
import { uniqueShopId, slugifyShopName } from "@/lib/slug";
import { BARBERS } from "@/lib/data";
import { requestSignupGeolocation } from "@/lib/signupGeolocation";
import { applyLateSignupShopLocation } from "@/lib/signupLateShopLocation";

function isValidEmail(value: string): boolean {
  const s = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function SignupPage() {
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [city, setCity] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [latStr, setLatStr] = useState("");
  const [lngStr, setLngStr] = useState("");
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /** Set after successful signup submit (shop + auth created). */
  const hasSubmittedRef = useRef(false);
  /** Shop id from last successful submit; used for late geo patch. */
  const submittedShopIdRef = useRef<string | null>(null);
  /** After shop document is saved, ignore late geolocation for form fields only. */
  const shopPersistedRef = useRef(false);
  /** Late Firestore location patch runs at most once per page load. */
  const lateSignupLocationAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setGeoLoading(true);
    void (async () => {
      const result = await requestSignupGeolocation();

      if (
        result.ok &&
        hasSubmittedRef.current &&
        submittedShopIdRef.current &&
        !lateSignupLocationAttemptedRef.current
      ) {
        const dbLate = getClientFirestore();
        if (dbLate) {
          lateSignupLocationAttemptedRef.current = true;
          void applyLateSignupShopLocation(
            dbLate,
            submittedShopIdRef.current,
            result.lat,
            result.lng,
            result.accuracyMeters
          );
        }
      }

      if (cancelled) return;
      if (shopPersistedRef.current) {
        setGeoLoading(false);
        return;
      }
      setGeoLoading(false);
      if (result.ok) {
        setGeoLat(result.lat);
        setGeoLng(result.lng);
        setLatStr(String(result.lat));
        setLngStr(String(result.lng));
        return;
      }
      if (result.reason !== "session_cached") {
        toast.message(
          "Location not enabled. Nearby suggestions may not work."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured()) {
      toast.error("Firebase is not configured");
      return;
    }
    const auth = getClientAuth();
    const db = getClientFirestore();
    if (!auth || !db) {
      toast.error("Client not ready");
      return;
    }
    if (!shopName.trim() || !city.trim()) {
      toast.error("Shop name and city are required");
      return;
    }
    const phone = normalizePhone(shopPhone);
    if (phone.length !== 12) {
      toast.error("Enter a valid mobile number for the shop");
      return;
    }
    let lat = 0;
    let lng = 0;
    let locationIncomplete = true;
    const lt = latStr.trim();
    const lg = lngStr.trim();
    const manualLa = lt !== "" ? Number(lt) : NaN;
    const manualLn = lg !== "" ? Number(lg) : NaN;
    const manualOk =
      Number.isFinite(manualLa) &&
      Number.isFinite(manualLn) &&
      !(manualLa === 0 && manualLn === 0);
    const geoOk =
      geoLat != null &&
      geoLng != null &&
      Number.isFinite(geoLat) &&
      Number.isFinite(geoLng) &&
      !(geoLat === 0 && geoLng === 0);
    if (manualOk) {
      lat = manualLa;
      lng = manualLn;
      locationIncomplete = false;
    } else if (geoOk) {
      lat = geoLat!;
      lng = geoLng!;
      locationIncomplete = false;
    } else {
      lat = 0;
      lng = 0;
      locationIncomplete = true;
    }
    if (!isValidEmail(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      let shopId = uniqueShopId(slugifyShopName(shopName), cred.user.uid);
      for (let attempt = 0; attempt < 12; attempt++) {
        const snap = await getDoc(doc(db, "shops", shopId));
        if (!snap.exists()) break;
        shopId = uniqueShopId(
          `${slugifyShopName(shopName)}-${attempt + 1}`,
          cred.user.uid
        );
      }
      const expiryMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
      await createShopDocument(db, shopId, {
        name: shopName.trim(),
        ownerId: cred.user.uid,
        phone,
        city: city.trim(),
        lat,
        lng,
        locationIncomplete,
        plan: "trial",
        expiryDate: Timestamp.fromMillis(expiryMs),
        isActive: true,
        staff: BARBERS.map((b) => ({
          id: b.id,
          name: b.name,
          active: true,
        })),
      });
      hasSubmittedRef.current = true;
      submittedShopIdRef.current = shopId;
      shopPersistedRef.current = true;
      await ensureUserProfile(db, cred.user.uid, email.trim());
      toast.success("Shop created");
      router.replace("/dashboard");
    } catch {
      toast.error("Signup failed", {
        description: "Try a different email or check password length.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
        Barber account
      </p>
      <h1 className="mt-3 font-serif text-3xl text-white">Create your shop</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Trial plan includes seven days from today.
      </p>
      {geoLoading ? (
        <p className="mt-2 text-xs text-neutral-500">Detecting location…</p>
      ) : null}
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Shop name
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            autoComplete="organization"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            City
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Shop phone
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={shopPhone}
            onChange={(e) => setShopPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Latitude (optional)
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={latStr}
            onChange={(e) => setLatStr(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Longitude (optional)
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={lngStr}
            onChange={(e) => setLngStr(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Email
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Password
          </label>
          <input
            type="password"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b]"
        >
          {busy ? "Creating…" : "Sign up"}
        </button>
      </form>
    </div>
  );
}
