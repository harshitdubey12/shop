import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoids dev-only RSC errors: "SegmentViewNode ... not in React Client Manifest"
  // when the devtools segment explorer bundles get out of sync (stale .next, HMR).
  experimental: {
    devtoolSegmentExplorer: false,
  },
  images: {
    // Explicit qualities for next/image (required in Next.js 16+; matches Hero, gallery, etc.)
    qualities: [75, 76, 78, 80, 82, 85, 90, 100],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
