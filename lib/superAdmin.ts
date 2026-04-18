/** Client side gate only; enforce privileged writes in Firestore rules too. */
export function isSuperAdminEmail(
  email: string | null | undefined
): boolean {
  const raw = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS?.trim();
  if (!raw || !email) return false;
  const set = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return set.includes(email.trim().toLowerCase());
}
