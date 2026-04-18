import { normalizePhone } from "./phone";

/** True when normalizePhone yields canonical 91xxxxxxxxxx (12 digits). */
export function isValidIndianMobile(raw: string): boolean {
  return normalizePhone(raw).length === 12;
}

export function validateBookingStepPayload(input: {
  serviceId: string | null;
  barberId: string | null;
  date: string | null;
  time: string | null;
  name: string;
  phone: string;
}): { ok: true } | { ok: false; message: string } {
  if (!input.serviceId?.trim()) {
    return { ok: false, message: "Choose a service to continue." };
  }
  if (
    input.barberId == null ||
    String(input.barberId).trim() === ""
  ) {
    return { ok: false, message: "Choose a barber for this visit." };
  }
  if (!input.date?.trim()) {
    return { ok: false, message: "Pick a date on the calendar." };
  }
  if (!input.time?.trim()) {
    return { ok: false, message: "Pick an available time slot." };
  }
  if (!input.name.trim()) {
    return { ok: false, message: "Add your full name as it should appear on the roster." };
  }
  if (!isValidIndianMobile(input.phone)) {
    return {
      ok: false,
      message: "Enter a valid 10 digit Indian mobile number (starts with 6–9).",
    };
  }
  return { ok: true };
}
