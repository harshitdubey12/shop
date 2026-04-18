export type BookingStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface ShopStaffMember {
  id: string;
  name: string;
  active: boolean;
}

/** Guest checkout and admin settlement (see firestore.rules). */
export type PaymentStatus = "pending_payment" | "paid" | "cash";

export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMins: number;
  icon: string;
  /** Highlight in the services grid (e.g. combo package). */
  mostPopular?: boolean;
}

export interface Barber {
  id: string;
  name: string;
  specialty: string;
  image: string;
}

/** Multi-tenant shop (Firestore: shops/{shopId}). */
export interface Shop {
  id: string;
  name: string;
  ownerId: string;
  /** Normalized Indian mobile (12 digits) when set; legacy rows may be empty. */
  phone: string;
  city: string;
  lat: number;
  lng: number;
  /**
   * True when coordinates were not provided or are placeholder (e.g. 0,0).
   * Nearby distance routing is disabled while this is true.
   */
  locationIncomplete: boolean;
  createdAt: number;
  isActive: boolean;
  plan: string;
  expiryDate: number;
  upiId?: string;
  /** WhatsApp for guests; when missing on read, use phone. New shops store phone here by default. */
  whatsappNumber?: string;
  /** In-shop staff; when empty, UI falls back to default BARBERS from data.ts. */
  staff?: ShopStaffMember[];
  /** Denormalized count of nested bookings; incremented on each create. Legacy shops may omit until backfill. */
  totalBookings?: number;
}

export interface Booking {
  id: string;
  /** Set for all new writes under shops/{shopId}/bookings. */
  shopId?: string;
  serviceId: string;
  serviceName: string;
  barberId: string | null;
  barberName: string | null;
  /** Operational assignment after load balancing (may differ from guest preference). */
  assignedBarberId?: string | null;
  assignedBarberName?: string | null;
  date: string;
  time: string;
  customerName: string;
  customerPhone: string;
  /** 1 based visit index for this phone at this shop; optional on legacy rows. */
  customerVisitNumber?: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  /**
   * Payment proof: demo uses a blob URL; production may store a Storage object
   * path (paymentProofs/...) when read rules are admin only, or an https URL for
   * legacy rows. Admin UI resolves paths after sign in.
   */
  paymentProofUrl?: string | null;
  amount: number;
  createdAt: number;
  /** When true, this booking was counted in shops/{shopId}.totalBookings. */
  countedInShopTotal?: boolean;
}

/** Denormalized guest profile per shop (Firestore: shops/{shopId}/customers/{phoneKey}). */
export interface ShopCustomer {
  phoneKey: string;
  customerName: string;
  visitCount: number;
  lastServiceId: string;
  lastServiceName: string;
  lastVisitTime: number;
  /** YYYY-MM-DD of last visit */
  lastVisitDate?: string;
  /** HH:mm preferred slot from last booking */
  preferredTime?: string;
}
