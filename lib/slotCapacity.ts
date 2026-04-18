import { slotsForDate } from "./slots";
import type { TimeSlot } from "./slots";

/**
 * Slot is unavailable when bookings at that time meet or exceed active staff count,
 * plus existing demo scarcity from slotsForDate.
 */
export function slotsForDateWithCapacity(
  iso: string,
  perTimeCounts: Record<string, number>,
  capacity: number
): TimeSlot[] {
  const full: string[] = [];
  for (const [t, n] of Object.entries(perTimeCounts)) {
    if (n >= capacity) full.push(t);
  }
  return slotsForDate(iso, full);
}

/** Next available HH:mm after a given time within the same day slot list. */
export function firstNextAvailableAfter(
  ordered: TimeSlot[],
  afterTime: string | null
): string | null {
  if (!afterTime) {
    return ordered.find((x) => x.available)?.time ?? null;
  }
  const idx = ordered.findIndex((x) => x.time === afterTime);
  const start = idx >= 0 ? idx + 1 : 0;
  for (let i = start; i < ordered.length; i++) {
    if (ordered[i]!.available) return ordered[i]!.time;
  }
  return null;
}
