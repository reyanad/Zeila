import type { Metadata } from "next";
import { ListingGrid } from "@/components/storefront/listing-card";
import { Pagination } from "@/components/storefront/pagination";
import { SearchFilters } from "@/components/storefront/search-filters";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";
import { categoryFilterOptions } from "@/lib/storefront/listings";
import { runSearch } from "@/lib/storefront/search";
import { parseSearch, type RawSearchParams } from "@/lib/storefront/search-params";

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "";
  // Result pages are useful to people, not as separate search-engine entries.
  return { title: q ? `“${q}”` : "Search", robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const [raw, fx, viewerCurrency, categories] = await Promise.all([searchParams, getFxRates(), getViewerCurrency(), categoryFilterOptions()]);
  const { params, echo } = parseSearch(raw, viewerCurrency, fx);
  const result = await runSearch(params);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{params.q ? `Results for “${params.q}”` : "Browse the marketplace"}</h1>
      <SearchFilters action="/search" echo={echo} categories={categories} viewerCurrency={viewerCurrency} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {result.total === 1 ? "1 result" : `${result.total.toLocaleString("en")} results`}
      </p>
      {result.hits.length > 0 ? (
        <ListingGrid listings={result.hits} viewerCurrency={viewerCurrency} fx={fx} />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing matches yet. Try fewer words or remove a filter.
        </div>
      )}
      <Pagination basePath="/search" params={echo} page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
