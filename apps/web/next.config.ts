import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@marketplace/ui", "@marketplace/shared-types", "@marketplace/database"],
  experimental: {
    // KYC uploads: up to four documents of 10 MB each in one server action.
    serverActions: {
      bodySizeLimit: "45mb",
    },
    // Requests to /seller/* pass through middleware, which buffers bodies
    // (10 MB by default); keep it in step with the server action limit.
    middlewareClientMaxBodySize: "45mb",
  },
};

export default nextConfig;
