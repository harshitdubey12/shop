export function buildMonthMatrix(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function formatISODate(year: number, monthIndex: number, day: number) {
  const m = `${monthIndex + 1}`.padStart(2, "0");
  const d = `${day}`.padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function formatClock12(hhmm: string): string {
  return new Date(`1970-01-01T${hhmm}:00`).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export type SlotTag = "popular" | "few_left";

export type TimeSlot = {
  time: string;
  available: boolean;
  tag?: SlotTag;
};

const POPULAR_TIMES = new Set([
  "12:00",
  "12:30",
  "13:00",
  "18:00",
  "18:30",
  "19:00",
]);

/** Base slot grid plus optional Firestore booked times (HH:mm). */
export function slotsForDate(
  iso: string,
  extraTakenTimes?: Iterable<string>
): TimeSlot[] {
  const taken = new Set<string>();
  for (let i = 0; i < iso.length; i++) {
    const code = iso.charCodeAt(i);
    if (code % 3 === 0) {
      const hour = 10 + (i % 8);
      const minute = i % 2 === 0 ? "00" : "30";
      taken.add(`${hour.toString().padStart(2, "0")}:${minute}`);
    }
  }
  if (extraTakenTimes) {
    for (const t of extraTakenTimes) taken.add(t);
  }
  const out: TimeSlot[] = [];
  for (let h = 10; h <= 21; h++) {
    for (const m of ["00", "30"] as const) {
      if (h === 21 && m === "30") continue;
      const label = `${h.toString().padStart(2, "0")}:${m}`;
      out.push({ time: label, available: !taken.has(label) });
    }
  }

  const availableTimes = out.filter((s) => s.available).map((s) => s.time);
  const lastTwo = availableTimes.slice(-2);

  for (const slot of out) {
    if (!slot.available) continue;
    if (POPULAR_TIMES.has(slot.time)) {
      slot.tag = "popular";
    }
  }
  for (const slot of out) {
    if (!slot.available || slot.tag) continue;
    if (lastTwo.includes(slot.time) && availableTimes.length <= 10) {
      slot.tag = "few_left";
    }
  }

  return out;
}
