import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SellerLayout({ children }: { children: ReactNode }) {
  await requireUser("/seller/onboarding");
  return children;
}
