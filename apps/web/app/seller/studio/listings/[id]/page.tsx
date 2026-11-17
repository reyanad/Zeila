import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingBuilder } from "@/components/studio/listing-builder";
import { draftFromInput } from "@/components/studio/builder-store";
import { categoryOptions, imageUrlMap, requireStudio, warehouseOptions } from "@/lib/studio/context";
import { loadListingForEditor } from "@/lib/studio/listings";

export const metadata: Metadata = { title: "Edit listing" };

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await requireStudio(`/seller/studio/listings/${id}`);
  const listing = await loadListingForEditor(store.id, id);
  if (!listing) notFound();
  const [warehouses, categories] = await Promise.all([warehouseOptions(store.id), categoryOptions()]);

  return (
    <ListingBuilder
      listingId={listing.id}
      slug={listing.slug}
      status={listing.status}
      moderationNote={listing.moderationNote}
      initial={draftFromInput(listing.input, imageUrlMap(listing.input.images.map((image) => image.key)))}
      warehouses={warehouses}
      categories={categories}
      currency={store.currency}
      storeActive={store.status === "ACTIVE"}
    />
  );
}
