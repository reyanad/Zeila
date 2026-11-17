import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/seller", "/admin", "/api/", "/login", "/register", "/search"] }],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
