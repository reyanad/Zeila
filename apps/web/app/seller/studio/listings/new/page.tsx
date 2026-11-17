import type { Metadata } from "next";
import Link from "next/link";
import { LISTING_TYPES, type ListingTypeValue } from "@marketplace/shared-types";
import { Card, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ListingBuilder } from "@/components/studio/listing-builder";
import { emptyDraft } from "@/components/studio/builder-store";
import { categoryOptions, requireStudio, warehouseOptions } from "@/lib/studio/context";

export const metadata: Metadata = { title: "New listing" };

const CHOICES: Array<{ type: ListingTypeValue; title: string; description: string }> = [
  { type: "PHYSICAL", title: "Physical product", description: "Goods you ship: variants, stock per warehouse, wholesale prices." },
  { type: "DIGITAL", title: "Digital product", description: "Files buyers download: templates, e-books, software with licence keys." },
  { type: "SERVICE", title: "Service", description: "Work you do for a buyer: Basic, Standard and Premium packages." },
];

export default async function NewListingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store } = await requireStudio("/seller/studio/listings/new");
  const params = await searchParams;
  const type = typeof params.type === "string" && (LISTING_TYPES as readonly string[]).includes(params.type) ? (params.type as ListingTypeValue) : null;

  if (!type) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">What are you selling?</h1>
        <div className="grid gap-4 md:grid-cols-3">
          {CHOICES.map((choice) => (
            <Link key={choice.type} href={`/seller/studio/listings/new?type=${choice.type}`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle>{choice.title}</CardTitle>
                  <CardDescription>{choice.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const [warehouses, categories] = await Promise.all([warehouseOptions(store.id), categoryOptions()]);
  return (
    <ListingBuilder
      listingId={null}
      slug={null}
      status={null}
      moderationNote={null}
      initial={emptyDraft(type)}
      warehouses={warehouses}
      categories={categories}
      currency={store.currency}
      storeActive={store.status === "ACTIVE"}
    />
  );
}
