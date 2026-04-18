import { CTABanner } from "@/components/home/CTABanner";
import { ContactMap } from "@/components/home/ContactMap";
import { GalleryPreview } from "@/components/home/GalleryPreview";
import { Hero } from "@/components/home/Hero";
import { RepeatCustomerHook } from "@/components/home/RepeatCustomerHook";
import { Services } from "@/components/home/Services";
import { SocialProofStrip } from "@/components/home/SocialProofStrip";
import { Testimonials } from "@/components/home/Testimonials";
import { WhyChooseUs } from "@/components/home/WhyChooseUs";
import { tenantBookingHref } from "@/lib/tenantBookingLink";

export function HomePageSections(props?: { tenantShopId?: string }) {
  const bookingHref = tenantBookingHref(props?.tenantShopId ?? null);
  return (
    <>
      <Hero bookingHref={bookingHref} />
      <SocialProofStrip />
      <Services />
      <RepeatCustomerHook bookingHref={bookingHref} />
      <WhyChooseUs />
      <GalleryPreview />
      <Testimonials />
      <CTABanner bookingHref={bookingHref} />
      <ContactMap />
    </>
  );
}
