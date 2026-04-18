"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { brandInitials, getBrand } from "@/config/brand";
import { bookingHrefFromPathname } from "@/lib/tenantBookingLink";

const staticLinks = [
  { href: "/", label: "Home" },
  { href: "/#services", label: "Services" },
  { href: "/gallery", label: "Gallery" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const bookHref = bookingHrefFromPathname(pathname);
  const links = [
    ...staticLinks.map((l) => ({ ...l })),
    { href: bookHref, label: "Book" },
  ];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const brand = getBrand();
  const initials = brandInitials();

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-all duration-300 ease-out ${
        scrolled
          ? "border-white/10 bg-[#0b0b0b]/92 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
          : "border-white/5 bg-[#0b0b0b]/70 py-4 backdrop-blur-xl"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 lg:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <span
            className={`flex items-center justify-center rounded-full border border-[#d4af37]/40 text-[10px] font-semibold tracking-[0.12em] text-[#d4af37] transition-all duration-300 ${
              scrolled ? "h-9 w-9" : "h-10 w-10"
            }`}
          >
            {initials}
          </span>
          <div className="leading-tight">
            <p className="text-[11px] uppercase tracking-[0.35em] text-neutral-500">
              Barbers
            </p>
            <p
              className={`font-serif text-white transition-all duration-300 group-hover:text-[#d4af37] ${
                scrolled ? "text-base" : "text-lg"
              }`}
            >
              {brand.name}
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 text-xs font-medium uppercase tracking-[0.2em] text-neutral-300 md:flex">
          {links.map((l) => {
            const active = pathname === l.href.split("#")[0];
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative transition hover:text-white ${
                  active ? "text-white" : ""
                }`}
              >
                {l.label}
                {active && (
                  <span className="absolute -bottom-2 left-0 right-0 mx-auto h-[2px] w-8 rounded-full bg-gradient-to-r from-transparent via-[#d4af37] to-transparent" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/admin/login"
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-200 transition duration-200 hover:scale-[1.03] hover:border-[#d4af37]/60 hover:text-white hover:shadow-[0_0_24px_rgba(212,175,55,0.12)] active:scale-[0.98]"
          >
            Concierge
          </Link>
          <Link
            href={bookHref}
            className="btn-ripple rounded-full bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b] glow-gold transition duration-200 hover:scale-[1.04] hover:brightness-105 active:scale-[0.97]"
          >
            Book seat
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-neutral-200 transition hover:border-[#d4af37]/40 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span className="text-xl">≡</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10 bg-[#0b0b0b]/95 md:hidden"
          >
            <div className="flex flex-col gap-2 px-4 py-4 text-sm uppercase tracking-[0.18em] text-neutral-200">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-white/5"
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/admin/login"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2 hover:bg-white/5"
              >
                Concierge login
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
