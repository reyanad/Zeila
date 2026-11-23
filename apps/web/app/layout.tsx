import type { Metadata } from "next";
import { APP_NAME, COMPANY_NAME } from "@marketplace/shared-types";
import type { ReactNode } from "react";
import { AffiliateTracker } from "@/components/growth/affiliate-tracker";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth/session";
import { realtimeUrl } from "@/lib/realtime";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description:
    "All-in-one marketplace for physical products, digital assets and professional services with escrow-protected payments.",
  applicationName: APP_NAME,
  publisher: COMPANY_NAME,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <RealtimeProvider url={user ? realtimeUrl() : null}>
          <SiteHeader />
          <AffiliateTracker />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </RealtimeProvider>
      </body>
    </html>
  );
}
