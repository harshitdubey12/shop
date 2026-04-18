import { doc, getDoc, type Firestore } from "firebase/firestore";
import { toast } from "sonner";
import { updateShopFields } from "@/lib/shops";
import { SIGNUP_GEO_MAX_ACCURACY_METERS } from "@/lib/signupGeolocation";

const LATE_SIGNUP_LOCATION_TOAST_SESSION_KEY =
  "signup_late_location_toast_shown";

function notifyLateSignupLocationPatchedOnce(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(LATE_SIGNUP_LOCATION_TOAST_SESSION_KEY) === "true") {
      return;
    }
    sessionStorage.setItem(LATE_SIGNUP_LOCATION_TOAST_SESSION_KEY, "true");
  } catch {
    return;
  }
  toast.message("Location updated automatically for better accuracy");
}

/**
 * After signup saved an incomplete or 0,0 location, applies a late geolocation fix
 * when coordinates become available. Does not overwrite a shop that already has a
 * usable location. Shows a one time toast per session after a successful patch.
 */
export async function applyLateSignupShopLocation(
  db: Firestore,
  shopId: string,
  geoLat: number,
  geoLng: number,
  accuracyMeters: number
): Promise<void> {
  if (
    !Number.isFinite(geoLat) ||
    !Number.isFinite(geoLng) ||
    (geoLat === 0 && geoLng === 0) ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters > SIGNUP_GEO_MAX_ACCURACY_METERS
  ) {
    return;
  }

  const snap = await getDoc(doc(db, "shops", shopId));
  if (!snap.exists()) return;

  const data = snap.data();
  const slat = typeof data.lat === "number" ? data.lat : Number(data.lat);
  const slng = typeof data.lng === "number" ? data.lng : Number(data.lng);
  const incompleteFlag = data.locationIncomplete === true;
  const zeroPair =
    Number.isFinite(slat) &&
    Number.isFinite(slng) &&
    slat === 0 &&
    slng === 0;

  if (!incompleteFlag && !zeroPair) return;

  try {
    await updateShopFields(db, shopId, {
      lat: geoLat,
      lng: geoLng,
      locationIncomplete: false,
    });
    notifyLateSignupLocationPatchedOnce();
  } catch {
    /* silent */
  }
}
