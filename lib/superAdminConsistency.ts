import { SUPER_ADMIN_EMAILS_AS_IN_FIRESTORE_RULES } from "./superAdminRulesMirror";

function parseEnvSuperAdminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Compares NEXT_PUBLIC_SUPER_ADMIN_EMAILS to the mirror of firestore.rules
 * superAdminEmailMap(). Logs when the sets differ.
 */
export function validateSuperAdminEmailsClientRulesConsistency(): void {
  if (typeof window === "undefined") return;
  const envSet = new Set(parseEnvSuperAdminEmails());
  const rulesSet = new Set(
    SUPER_ADMIN_EMAILS_AS_IN_FIRESTORE_RULES.map((e) =>
      e.trim().toLowerCase()
    ).filter(Boolean)
  );
  if (envSet.size !== rulesSet.size) {
    console.error(
      "Super admin email mismatch between client and Firestore rules"
    );
    return;
  }
  for (const e of envSet) {
    if (!rulesSet.has(e)) {
      console.error(
        "Super admin email mismatch between client and Firestore rules"
      );
      return;
    }
  }
}
