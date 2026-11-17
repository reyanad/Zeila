import type { Metadata } from "next";
import { parseShippingProfile } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ShippingForm } from "@/components/studio/shipping-form";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Shipping rates" };

export default async function ShippingPage() {
  const { store } = await requireStudio("/seller/studio/shipping");
  const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id }, select: { shippingProfile: true } });
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Shipping rates</CardTitle>
        <CardDescription>
          Charged once per order from your store, by total weight. Downloads and services never pay shipping. Physical products cannot be
          published until rates are set.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ShippingForm profile={parseShippingProfile(row.shippingProfile)} currency={store.currency} />
      </CardContent>
    </Card>
  );
}
