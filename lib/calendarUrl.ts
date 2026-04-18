/** Google Calendar "create event" link (no backend). */
export function buildGoogleCalendarUrl(input: {
  title: string;
  /** YYYY-MM-DD */
  dateIso: string;
  /** HH:mm 24h */
  timeHm: string;
  durationMins: number;
  details: string;
}): string {
  const [y, mo, d] = input.dateIso.split("-").map(Number);
  const [hh, mm] = input.timeHm.split(":").map(Number);
  const start = new Date(y!, mo! - 1, d!, hh ?? 10, mm ?? 0, 0);
  const end = new Date(start.getTime() + input.durationMins * 60 * 1000);
  const fmt = (dt: Date) =>
    dt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: input.details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
