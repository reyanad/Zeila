import path from "node:path";
import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()' },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server bundle for the Docker image (traces the monorepo's packages).
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
