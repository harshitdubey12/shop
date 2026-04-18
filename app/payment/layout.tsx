import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getBrand } from "@/config/brand";

const brand = getBrand();

export const metadata: Metadata = {
  title: "Payment",
  description: `Complete checkout for a booking at ${brand.name}.`,
};

export default function PaymentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
