/**
 * Logs configuration gaps on the client. Does not throw.
 * Call once from a client Provider after mount.
 */
import { getConfiguredDefaultShopId } from "./defaultShop";
import { validateSuperAdminEmailsClientRulesConsistency } from "./superAdminConsistency";

export function logClientEnvWarnings(): void {
  if (typeof window === "undefined") return;
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()) {
    missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) {
    missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }
  if (!process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID?.trim()) {
    missing.push("NEXT_PUBLIC_DEFAULT_SHOP_ID");
  }
  if (!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS?.trim()) {
    missing.push("NEXT_PUBLIC_SUPER_ADMIN_EMAILS");
  }
  if (missing.length > 0) {
    console.warn(
      "[barber] Missing or empty env vars (some features may be disabled):",
      missing.join(", ")
    );
  }

  validateSuperAdminEmailsClientRulesConsistency();

  const missingFirebase =
    !process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const missingDefaultShop = getConfiguredDefaultShopId() === null;

  if (missingFirebase || missingDefaultShop) {
    console.info(
      "[barber] Public booking uses local demo when Firebase env is unset; default shop id falls back to _default when NEXT_PUBLIC_DEFAULT_SHOP_ID is unset."
    );
  }
}
