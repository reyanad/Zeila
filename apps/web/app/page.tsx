import Link from "next/link";
import type { ListingCard } from "@marketplace/search";
import { buttonVariants } from "@marketplace/ui";
import { ListingGrid } from "@/components/storefront/listing-card";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";
import { rootCategories } from "@/lib/storefront/listings";
import { runSearch } from "@/lib/storefront/search";

export const dynamic = "force-dynamic";

async function section(type: ListingCard["type"] | undefined, sort: "newest" | "popular"): Promise<ListingCard[]> {
  const result = await runSearch({ q: "", type, sort, page: 1, pageSize: 8 });
  return result.hits;
}

function Section({ title, href, listings, children }: { title: string; href: string; listings: ListingCard[]; children: React.ReactNode }) {
  if (listings.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <Link href={href} className="text-sm font-medium underline-offset-4 hover:underline">
          See all
        </Link>
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const [categories, newest, services, downloads, fx, viewerCurrency] = await Promise.all([
    rootCategories(),
    section(undefined, "newest"),
    section("SERVICE", "popular"),
    section("DIGITAL", "popular"),
    getFxRates(),
    getViewerCurrency(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10">
      <section className="flex flex-col gap-5 rounded-xl bg-muted/50 px-6 py-10">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Products, downloads and services from trusted local sellers</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every payment is held safely until your order arrives or the work is approved.
        </p>
        <form action="/search" role="search" className="flex max-w-xl gap-2">
          <label htmlFor="hero-search" className="sr-only">
            What are you looking for?
          </label>
          <input
            id="hero-search"
            name="q"
            type="search"
            placeholder="Try “logo design”, “coffee” or “phone repair”"
            className="h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <button type="submit" className={buttonVariants({ size: "lg" })}>
            Search
          </button>
        </form>
        {categories.length > 0 ? (
          <nav aria-label="Categories" className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Link key={category.slug} href={`/c/${category.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </section>

      <Section title="New arrivals" href="/search?sort=newest" listings={newest}>
        <ListingGrid listings={newest} viewerCurrency={viewerCurrency} fx={fx} />
      </Section>
      <Section title="Popular services" href="/search?type=SERVICE&sort=popular" listings={services}>
        <ListingGrid listings={services} viewerCurrency={viewerCurrency} fx={fx} />
      </Section>
      <Section title="Digital downloads" href="/search?type=DIGITAL&sort=popular" listings={downloads}>
        <ListingGrid listings={downloads} viewerCurrency={viewerCurrency} fx={fx} />
      </Section>

      {newest.length === 0 ? (
        <section className="rounded-lg border border-dashed border-border p-10 text-center">
          <h2 className="text-lg font-semibold">The marketplace is getting ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sellers are setting up their stores. Want to be one of the first?</p>
          <Link href="/seller/onboarding" className={`${buttonVariants()} mt-4`}>
            Start selling
          </Link>
        </section>
      ) : null}
    </div>
  );
}
