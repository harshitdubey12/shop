/**
 * Must match the keys inside superAdminEmailMap() in firestore.rules exactly
 * (same addresses, lowercase). When you change rules, update this array and .env.
 * Leave empty until you add real super admins (keep in sync with deployed rules).
 */
export const SUPER_ADMIN_EMAILS_AS_IN_FIRESTORE_RULES: readonly string[] = [];
