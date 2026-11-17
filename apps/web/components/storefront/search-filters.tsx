import { buttonVariants } from "@marketplace/ui";

const SORT_LABELS = {
  relevance: "Best match",
  newest: "Newest",
  popular: "Most popular",
  rating: "Highest rated",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
} as const;

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Plain GET form: filtering works without JavaScript and every result page has a shareable URL. */
export function SearchFilters({
  action,
  echo,
  categories,
  viewerCurrency,
  showType = true,
  showCategory = true,
}: {
  action: string;
  echo: Record<string, string>;
  categories: Array<{ value: string; label: string }>;
  viewerCurrency: string;
  showType?: boolean;
  showCategory?: boolean;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor="filter-q" className="text-xs font-medium">
          Search
        </label>
        <input id="filter-q" name="q" type="search" defaultValue={echo.q} className="h-9 rounded-md border border-input bg-background px-3 text-sm" />
      </div>
      {showType ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-type" className="text-xs font-medium">
            Type
          </label>
          <select id="filter-type" name="type" defaultValue={echo.type ?? ""} className={selectClass}>
            <option value="">Everything</option>
            <option value="PHYSICAL">Products</option>
            <option value="DIGITAL">Downloads</option>
            <option value="SERVICE">Services</option>
          </select>
        </div>
      ) : null}
      {showCategory ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-category" className="text-xs font-medium">
            Category
          </label>
          <select id="filter-category" name="category" defaultValue={echo.category ?? ""} className={selectClass}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium">Price ({viewerCurrency})</span>
        <div className="flex items-center gap-1">
          <label htmlFor="filter-min" className="sr-only">
            Minimum price
          </label>
          <input id="filter-min" name="min" inputMode="decimal" placeholder="Min" defaultValue={echo.min} className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm" />
          <span aria-hidden>–</span>
          <label htmlFor="filter-max" className="sr-only">
            Maximum price
          </label>
          <input id="filter-max" name="max" inputMode="decimal" placeholder="Max" defaultValue={echo.max} className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-sort" className="text-xs font-medium">
          Sort
        </label>
        <select id="filter-sort" name="sort" defaultValue={echo.sort ?? ""} className={selectClass}>
          <option value="">{echo.q ? SORT_LABELS.relevance : SORT_LABELS.newest}</option>
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="stock" value="1" defaultChecked={echo.stock === "1"} className="h-4 w-4" />
        In stock
      </label>
      <button type="submit" className={buttonVariants({ size: "sm" })}>
        Apply
      </button>
    </form>
  );
}
