import type { Metadata } from "next";
import { DefaultShopBookingGate } from "@/components/booking/DefaultShopBookingGate";
import { getBrand } from "@/config/brand";

const brand = getBrand();

export const metadata: Metadata = {
  title: "Book appointment",
  description: `Book a chair at ${brand.name}. ${brand.tagline}`,
};

export default function BookingPage() {
  return <DefaultShopBookingGate />;
}
