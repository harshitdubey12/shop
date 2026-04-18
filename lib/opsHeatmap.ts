import type { Booking } from "./types";

/** Hour bucket 0-23 from "HH:mm". */
function hourFromSlot(hhmm: string): number {
  const h = parseInt(hhmm.slice(0, 2), 10);
  return Number.isFinite(h) ? h : 12;
}

/**
 * Simple text indicators from booking times (today or provided rows).
 * Peak band 17:00-21:00, low band 14:00-16:00 (IST wall clock from stored HH:mm).
 */
export function describeBusyPattern(rows: Booking[]): {
  peakLabel: string;
  lowLabel: string;
} {
  const active = rows.filter((b) => b.status !== "cancelled");
  let peak = 0;
  let low = 0;
  for (const b of active) {
    const h = hourFromSlot(b.time);
    if (h >= 17 && h <= 21) peak += 1;
    if (h >= 14 && h <= 16) low += 1;
  }
  const peakLabel =
    peak >= low && peak > 0
      ? "Peak Hours"
      : peak > 0
        ? "Peak Hours"
        : "Peak Hours (quiet today)";
  const lowLabel =
    low > 0 && low < peak
      ? "Low Traffic"
      : low > 0
        ? "Low Traffic"
        : "Low Traffic (open afternoon)";
  return {
    peakLabel: peakLabel.includes("Peak") && peak > 0 ? `${peakLabel} 🔥` : peakLabel,
    lowLabel,
  };
}

function formatHourBandLabel(startH: number, widthHours: number): string {
  const a = new Date(2000, 0, 1, startH, 0, 0, 0);
  const b = new Date(a.getTime() + widthHours * 60 * 60 * 1000);
  const left = a.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const right = b.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${left}–${right}`;
}

/** Simple text insight from hour histogram (active bookings in `rows`). */
export function peakLowTimeInsights(rows: Booking[]): {
  peakRange: string;
  lowRange: string;
} {
  const active = rows.filter((b) => b.status !== "cancelled");
  const byHour: Record<number, number> = {};
  for (const b of active) {
    const h = hourFromSlot(b.time);
    byHour[h] = (byHour[h] ?? 0) + 1;
  }
  let peakH = 17;
  let maxC = -1;
  for (let h = 9; h <= 21; h++) {
    const c = byHour[h] ?? 0;
    if (c > maxC) {
      maxC = c;
      peakH = h;
    }
  }
  let lowH = 14;
  let minC = Number.MAX_SAFE_INTEGER;
  for (let h = 9; h <= 21; h++) {
    const c = byHour[h] ?? 0;
    if (c < minC) {
      minC = c;
      lowH = h;
    }
  }
  if (active.length === 0) {
    return {
      peakRange: "Peak hours today: (no data yet)",
      lowRange: "Low traffic hours: (no data yet)",
    };
  }
  return {
    peakRange: `Peak hours today: ${formatHourBandLabel(peakH, 2)}`,
    lowRange: `Low traffic hours: ${formatHourBandLabel(lowH, 2)}`,
  };
}
