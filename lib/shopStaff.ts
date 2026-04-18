import type { Barber, Shop, ShopStaffMember } from "./types";
import { BARBERS } from "./data";

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80";

/** Active staff for a shop, falling back to default BARBERS when unset. */
export function getActiveStaffMembers(shop: Shop | null): ShopStaffMember[] {
  const raw = shop?.staff?.filter((s) => s.active) ?? [];
  if (raw.length > 0) return raw;
  return BARBERS.map((b) => ({
    id: b.id,
    name: b.name,
    active: true,
  }));
}

/** Wizard list: staff rows merged with display images from default BARBERS when ids match. */
export function staffAsBarbersForWizard(shop: Shop | null): Barber[] {
  const members = getActiveStaffMembers(shop);
  return members.map((m, i) => {
    const fromDefault = BARBERS.find((b) => b.id === m.id);
    return {
      id: m.id,
      name: m.name,
      specialty: fromDefault?.specialty ?? "Stylist",
      image: fromDefault?.image ?? BARBERS[i % BARBERS.length]!.image ?? PLACEHOLDER,
    };
  });
}

export const AUTO_BARBER_ID = "__auto__";
