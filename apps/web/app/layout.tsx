import type { Metadata } from "next";
import { APP_NAME } from "@marketplace/shared-types";
import type { ReactNode } from "react";
import { AffiliateTracker } from "@/components/growth/affiliate-tracker";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth/session";
import { realtimeUrl } from "@/lib/realtime";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description:
    "All-in-one marketplace for physical products, digital assets and professional services with escrow-protected payments.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <RealtimeProvider url={user ? realtimeUrl() : null}>
          <SiteHeader />
          <AffiliateTracker />
          <main>{children}</main>
        </RealtimeProvider>
      </body>
    </html>
  );
}
