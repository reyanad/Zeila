import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@marketplace/ui", "@marketplace/shared-types", "@marketplace/database"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
