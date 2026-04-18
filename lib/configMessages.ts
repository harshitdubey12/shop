/** User-facing copy when deployment config is incomplete (env, shop doc, etc.). */
export const SYSTEM_CONFIG_INCOMPLETE_MESSAGE =
  "System configuration incomplete. Please contact admin.";

export const BOOKING_DATA_MISMATCH_MESSAGE =
  "Booking data mismatch. Please retry.";

export const BOOKING_NOT_FOUND_MESSAGE = "Booking not found";

/** Payment URL is missing ?shop= while Firebase is active (updates may miss the nested shop path). */
export const PAYMENT_SHOP_QUERY_MISSING_MESSAGE =
  "Shop not configured. Booking may not be saved.";
