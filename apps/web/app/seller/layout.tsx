import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SellerLayout({ children }: { children: ReactNode }) {
  await requireUser("/seller/onboarding");
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">{children}</div>;
}
