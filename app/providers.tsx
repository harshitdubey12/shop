"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { RouteTransitionLoader } from "@/components/RouteTransitionLoader";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { logClientEnvWarnings } from "@/lib/envCheck";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    logClientEnvWarnings();
  }, []);
  return (
    <>
      <RouteTransitionLoader />
      <GlobalErrorBoundary>{children}</GlobalErrorBoundary>
      <Toaster richColors position="top-center" theme="dark" />
    </>
  );
}
