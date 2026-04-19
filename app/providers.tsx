"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { RouteTransitionLoader } from "@/components/RouteTransitionLoader";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { logClientEnvWarnings } from "@/lib/envCheck";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5000, // 5 seconds
        refetchOnWindowFocus: true,
      },
    },
  }));

  useEffect(() => {
    logClientEnvWarnings();
  }, []);
  
  return (
    <QueryClientProvider client={queryClient}>
      <RouteTransitionLoader />
      <GlobalErrorBoundary>{children}</GlobalErrorBoundary>
      <Toaster richColors position="top-center" theme="dark" />
    </QueryClientProvider>
  );
}
