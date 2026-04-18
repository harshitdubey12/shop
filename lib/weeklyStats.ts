import type { Booking } from "./types";

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Monday 00:00 local of the week containing `d`. */
export function weekMondayIso(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const mo = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function weekSundayIsoFromMonday(mondayIso: string): string {
  const d = parseYmd(mondayIso);
  d.setDate(d.getDate() + 6);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

const SHORT: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

/**
 * Bookings between weekStartIso and weekEndIso (inclusive), completed only (same as earnings).
 */
export function weeklyBookingDayStats(
  rows: Booking[],
  weekStartIso: string,
  weekEndIso: string
): {
  total: number;
  busiestDay: string;
  leastBusyDay: string;
} {
  const counts: Record<number, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };
  for (const b of rows) {
    if (b.date < weekStartIso || b.date > weekEndIso) continue;
    if (b.status !== "completed") continue;
    const wd = parseYmd(b.date).getDay();
    counts[wd] = (counts[wd] ?? 0) + 1;
  }
  let total = 0;
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) total += counts[wd] ?? 0;

  let maxWd = 1;
  let minWd = 1;
  let maxC = -1;
  let minC = Number.MAX_SAFE_INTEGER;
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
    const c = counts[wd] ?? 0;
    if (c > maxC) {
      maxC = c;
      maxWd = wd;
    }
    if (c < minC) {
      minC = c;
      minWd = wd;
    }
  }

  if (total === 0) {
    return {
      total: 0,
      busiestDay: "—",
      leastBusyDay: "—",
    };
  }

  const busyLabel =
    maxC > 0 ? (SHORT[maxWd] ?? "?") : "—";
  const slowLabel =
    minC < maxC || (minC === maxC && maxC > 0)
      ? (SHORT[minWd] ?? "?")
      : busyLabel;

  return {
    total,
    busiestDay: busyLabel,
    leastBusyDay: slowLabel,
  };
}
