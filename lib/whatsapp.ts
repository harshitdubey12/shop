import { hasWhatsAppConfigured, whatsappDigits } from "@/config/brand";

export function buildWhatsAppLink(
  phoneDigits: string,
  message: string
): string {
  const cleaned = phoneDigits.replace(/\D/g, "");
  const text = encodeURIComponent(message);
  return `https://wa.me/${cleaned}?text=${text}`;
}

function safeField(value: string | undefined | null, fallback: string): string {
  const t = String(value ?? "").trim();
  return t.length > 0 ? t : fallback;
}

/**
 * Prefilled guest message for wa.me (UTF-8 then URL encoded in buildWhatsAppLink).
 */
export function buildAppointmentWhatsAppMessage(params: {
  customerName: string;
  serviceName: string;
  date: string;
  timeLabel: string;
}): string {
  const customerName = safeField(params.customerName, "Guest");
  const serviceName = safeField(params.serviceName, "Service");
  const date = safeField(params.date, "To be confirmed");
  const timeLabel = safeField(params.timeLabel, "To be confirmed");
  return [
    "Hi, I have booked an appointment.",
    "",
    `Name: ${customerName}`,
    `Service: ${serviceName}`,
    `Date: ${date}`,
    `Time: ${timeLabel}`,
  ].join("\n");
}

/** Opens WhatsApp in a new tab. Returns false if the site has no desk number configured. */
export function openWhatsAppWithMessage(message: string): boolean {
  if (!hasWhatsAppConfigured()) return false;
  const href = buildWhatsAppLink(whatsappDigits(), message);
  window.open(href, "_blank", "noopener,noreferrer");
  return true;
}
