/**
 * Tenant shop booking URL when the user is under /app/[shopId]/…, else default guest booking.
 */
export function bookingHrefFromPathname(pathname: string | null | undefined): string {
  if (!pathname) return "/booking";
  const m = pathname.match(/^\/app\/([^/]+)/);
  return m ? `/app/${m[1]}/booking` : "/booking";
}

export function tenantBookingHref(shopId: string | undefined | null): string {
  return shopId ? `/app/${shopId}/booking` : "/booking";
}
