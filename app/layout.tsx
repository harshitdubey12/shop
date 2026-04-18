import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageLoader } from "@/components/PageLoader";
import { MobileStickyBooking } from "@/components/MobileStickyBooking";
import { getBrand } from "@/config/brand";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

const dm = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
});

function metadataBaseUrl(): URL | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

const metaBase = metadataBaseUrl();
const brand = getBrand();

export const metadata: Metadata = {
  ...(metaBase ? { metadataBase: metaBase } : {}),
  title: {
    default: `${brand.name} · Book your visit`,
    template: `%s · ${brand.name}`,
  },
  description: `${brand.name}. ${brand.tagline}`,
  keywords: ["barber", "haircut", "booking", brand.name],
  openGraph: {
    type: "website",
    locale: "en_IN",
    ...(metaBase ? { url: metaBase.href } : {}),
    siteName: brand.name,
    title: `${brand.name} · Book your visit`,
    description: brand.tagline,
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.name} · Book your visit`,
    description: brand.tagline,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${playfair.variable} ${dm.variable} antialiased`}>
        <Providers>
          <ScrollProgress />
          <PageLoader />
          <Navbar />
          <main className="pb-44 md:pb-0">{children}</main>
          <Footer />
          <WhatsAppFloat />
          <MobileStickyBooking />
        </Providers>
      </body>
    </html>
  );
}
