import type { Metadata } from "next";
import { GalleryMasonry } from "@/components/gallery/GalleryMasonry";
import { getBrand } from "@/config/brand";

export const metadata: Metadata = {
  title: "Gallery",
  description: `Hair, beard, and studio frames from ${getBrand().name}.`,
};

export default function GalleryPage() {
  return <GalleryMasonry />;
}
