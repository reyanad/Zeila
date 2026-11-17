import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@marketplace/database";
import { buttonVariants } from "@marketplace/ui";
import { ListingGrid } from "@/components/storefront/listing-card";
import { Pagination } from "@/components/storefront/pagination";
import { SearchFilters } from "@/components/storefront/search-filters";
import { siteUrl } from "@/lib/env";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";
import { categoryTrail } from "@/lib/storefront/listings";
import { runSearch } from "@/lib/storefront/search";
import { parseSearch, type RawSearchParams } from "@/lib/storefront/search-params";

async function loadCategory(slug: string) {
  return prisma.category.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      children: { where: { isActive: true }, orderBy: { position: "asc" }, select: { name: true, slug: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: category.name,
    description: `Shop ${category.name.toLowerCase()} from independent sellers, with payments held safely until delivery.`,
    alternates: { canonical: siteUrl(`/c/${category.slug}`) },
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) notFound();

  const [raw, fx, viewerCurrency, trail] = await Promise.all([searchParams, getFxRates(), getViewerCurrency(), categoryTrail(category.path)]);
  const { params: search, echo } = parseSearch(raw, viewerCurrency, fx, { category: category.slug });
  const result = await runSearch(search);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          {trail.map((crumb) => (
            <li key={crumb.slug} className="before:mr-1 before:content-['›']">
              {crumb.slug === category.slug ? (
                <span aria-current="page">{crumb.name}</span>
              ) : (
                <Link href={`/c/${crumb.slug}`} className="hover:underline">
                  {crumb.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{category.name}</h1>
      {category.children.length > 0 ? (
        <nav aria-label="Subcategories" className="flex flex-wrap gap-2">
          {category.children.map((child) => (
            <Link key={child.slug} href={`/c/${child.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {child.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <SearchFilters action={`/c/${category.slug}`} echo={echo} categories={[]} viewerCurrency={viewerCurrency} showCategory={false} />
      {result.hits.length > 0 ? (
        <ListingGrid listings={result.hits} viewerCurrency={viewerCurrency} fx={fx} />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No listings here yet.</div>
      )}
      <Pagination basePath={`/c/${category.slug}`} params={echo} page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
