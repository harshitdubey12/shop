/** Reject readings worse than this (meters); matches typical city-scale usefulness. */
export const SIGNUP_GEO_MAX_ACCURACY_METERS = 1000;

/** Session flag: skip slow repeat geolocation after a failed attempt (low accuracy, denied, timeout). */
export const SIGNUP_GEO_UNAVAILABLE_STORAGE_KEY = "signup_geo_unavailable";

/** How long to honor the unavailable cache before allowing another geolocation attempt (ms). */
export const SIGNUP_GEO_UNAVAILABLE_TTL_MS = 10 * 60 * 1000;

type SignupGeoUnavailablePayload = {
  value: "true";
  ts: number;
};

export type SignupGeolocationResult =
  | { ok: true; lat: number; lng: number; accuracyMeters: number }
  | {
      ok: false;
      reason:
        | "denied"
        | "timeout"
        | "unsupported"
        | "low_accuracy"
        | "session_cached";
    };

function readSignupGeoUnavailableCached(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    const raw = sessionStorage.getItem(SIGNUP_GEO_UNAVAILABLE_STORAGE_KEY);
    if (raw == null || raw === "") return false;

    if (raw === "true") {
      markSignupGeoUnavailableCached();
      return true;
    }

    const parsed = JSON.parse(raw) as Partial<SignupGeoUnavailablePayload>;
    if (parsed.value !== "true" || typeof parsed.ts !== "number") {
      return false;
    }
    if (Date.now() - parsed.ts > SIGNUP_GEO_UNAVAILABLE_TTL_MS) {
      sessionStorage.removeItem(SIGNUP_GEO_UNAVAILABLE_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Persist so this tab skips further geolocation calls until TTL elapses. */
function markSignupGeoUnavailableCached(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      const payload: SignupGeoUnavailablePayload = {
        value: "true",
        ts: Date.now(),
      };
      sessionStorage.setItem(
        SIGNUP_GEO_UNAVAILABLE_STORAGE_KEY,
        JSON.stringify(payload)
      );
    }
  } catch {
    /* ignore */
  }
}

function isValidGeoFix(
  lat: number,
  lng: number,
  accuracyMeters: number
): boolean {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  ) {
    return false;
  }
  if (
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters > SIGNUP_GEO_MAX_ACCURACY_METERS
  ) {
    return false;
  }
  return true;
}

function needsHighAccuracyRetry(pos: GeolocationPosition): boolean {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy;
  return !isValidGeoFix(lat, lng, acc);
}

function getCurrentPositionPromise(
  options: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function mapPositionError(e: unknown): SignupGeolocationResult {
  markSignupGeoUnavailableCached();
  const err = e as GeolocationPositionError | undefined;
  const code = err?.code;
  if (code === 3) {
    return { ok: false, reason: "timeout" };
  }
  return { ok: false, reason: "denied" };
}

const FIRST_ATTEMPT_OPTS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 3000,
  maximumAge: 60_000,
};

const RETRY_ATTEMPT_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 5000,
  maximumAge: 60_000,
};

/**
 * Two-phase signup location: fast low-power first, then one high-accuracy retry if needed.
 * Accepts only fixes with accuracy <= SIGNUP_GEO_MAX_ACCURACY_METERS (and valid lat/lng).
 */
export async function requestSignupGeolocation(): Promise<SignupGeolocationResult> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.geolocation
  ) {
    return { ok: false, reason: "unsupported" };
  }

  if (readSignupGeoUnavailableCached()) {
    return { ok: false, reason: "session_cached" };
  }

  let first: GeolocationPosition | null = null;
  try {
    first = await getCurrentPositionPromise(FIRST_ATTEMPT_OPTS);
  } catch {
    first = null;
  }

  if (first !== null && !needsHighAccuracyRetry(first)) {
    return {
      ok: true,
      lat: first.coords.latitude,
      lng: first.coords.longitude,
      accuracyMeters: first.coords.accuracy,
    };
  }

  try {
    const second = await getCurrentPositionPromise(RETRY_ATTEMPT_OPTS);
    const lat = second.coords.latitude;
    const lng = second.coords.longitude;
    const accuracyMeters = second.coords.accuracy;
    if (!isValidGeoFix(lat, lng, accuracyMeters)) {
      markSignupGeoUnavailableCached();
      return { ok: false, reason: "low_accuracy" };
    }
    return {
      ok: true,
      lat,
      lng,
      accuracyMeters,
    };
  } catch (e) {
    return mapPositionError(e);
  }
}
