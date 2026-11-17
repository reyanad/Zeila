import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@marketplace/database";
import { ListingGrid } from "@/components/storefront/listing-card";
import { Pagination } from "@/components/storefront/pagination";
import { SearchFilters } from "@/components/storefront/search-filters";
import { siteUrl } from "@/lib/env";
import { countryName } from "@/lib/storefront/detail";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";
import { runSearch } from "@/lib/storefront/search";
import { parseSearch, type RawSearchParams } from "@/lib/storefront/search-params";

const loadStore = cache(async (slug: string) =>
  prisma.store.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { name: true, slug: true, tagline: true, description: true, country: true, createdAt: true, vacationMode: true },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) return { title: "Store not found" };
  return {
    title: store.name,
    description: store.tagline ?? `Shop ${store.name} on the marketplace.`,
    alternates: { canonical: siteUrl(`/store/${store.slug}`) },
  };
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) notFound();
  const [raw, fx, viewerCurrency] = await Promise.all([searchParams, getFxRates(), getViewerCurrency()]);
  const { params: search, echo } = parseSearch(raw, viewerCurrency, fx, { storeSlug: store.slug });
  const result = store.vacationMode ? null : await runSearch(search);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{store.name}</h1>
        {store.tagline ? <p className="text-muted-foreground">{store.tagline}</p> : null}
        <p className="text-sm text-muted-foreground">
          {countryName(store.country)} · selling since {store.createdAt.getFullYear()}
        </p>
      </header>
      {result === null ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          This store is on a break and not taking orders right now.
        </p>
      ) : (
        <>
          <SearchFilters action={`/store/${store.slug}`} echo={echo} categories={[]} viewerCurrency={viewerCurrency} showCategory={false} />
          {result.hits.length > 0 ? (
            <ListingGrid listings={result.hits} viewerCurrency={viewerCurrency} fx={fx} />
          ) : (
            <p className="text-sm text-muted-foreground">No listings match.</p>
          )}
          <Pagination basePath={`/store/${store.slug}`} params={echo} page={result.page} pageSize={result.pageSize} total={result.total} />
        </>
      )}
    </div>
  );
}
