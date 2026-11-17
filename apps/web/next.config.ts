import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load queue clients from node_modules at runtime instead of bundling them
  // (BullMQ has optional backends and dynamic requires webpack cannot follow).
  serverExternalPackages: ["bullmq", "ioredis"],
  transpilePackages: [
    "@marketplace/ui",
    "@marketplace/shared-types",
    "@marketplace/database",
    "@marketplace/search",
    "@marketplace/jobs",
    "@marketplace/core",
    "@marketplace/realtime",
  ],
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
