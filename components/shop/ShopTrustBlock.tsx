"use client";

import { useTrustProfile } from "@/lib/api";
import { motion } from "framer-motion";

export function ShopTrustBlock({ shopId }: { shopId: string }) {
  const { data: profile, isLoading, error } = useTrustProfile(shopId);

  if (isLoading) {
    return (
      <div className="mx-auto mt-6 max-w-5xl px-4 lg:px-6">
        <div className="animate-pulse rounded-3xl border border-white/5 bg-white/5 p-6 h-32" />
      </div>
    );
  }

  if (error || !profile) {
    return null;
  }

  return (
    <div className="mx-auto mt-6 max-w-5xl px-4 lg:px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card flex flex-col items-start gap-6 rounded-3xl border border-[#d4af37]/30 bg-black/40 p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex-1">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-[#d4af37]">
            Trusted Vendor
          </h3>
          <p className="mt-2 text-xs text-neutral-400 max-w-sm leading-relaxed">
            This shop has been verified by our platform for exceptional quality, punctuality, and customer satisfaction.
          </p>
        </div>

        <div className="flex w-full grid-cols-2 flex-wrap gap-4 sm:w-auto sm:gap-6">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/50 px-5 py-3 min-w-[120px]">
            <span className="text-2xl font-serif text-white">
              {profile.punctuality_score}%
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
              Punctuality
            </span>
          </div>

          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/50 px-5 py-3 min-w-[120px]">
            <span className="text-2xl font-serif text-white">
              {profile.completion_rate}%
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
              Completion
            </span>
          </div>
          
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/50 px-5 py-3 min-w-[120px]">
            <span className="text-2xl font-serif text-[#d4af37] flex items-center gap-1">
              {profile.rating?.toFixed(1) || "5.0"}
              <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
              {profile.review_count || "New"} Reviews
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
