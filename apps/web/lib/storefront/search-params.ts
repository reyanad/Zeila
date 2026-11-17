import "server-only";
import { convertMinor, LISTING_TYPES, parseMoneyInput, type FxRates } from "@marketplace/shared-types";
import { SEARCH_SORTS, type SearchParams, type SearchSort } from "@marketplace/search";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedSearch {
  params: SearchParams;
  /** Values to echo into the filter form and pagination links. */
  echo: Record<string, string>;
}

const PAGE_SIZE = 24;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * Parse search query parameters. Price bounds are typed in the visitor's
 * currency and converted to the index's sort currency (USD when rates exist).
 */
export function parseSearch(raw: RawSearchParams, viewerCurrency: string, fx: FxRates | null, fixed: Partial<SearchParams> = {}): ParsedSearch {
  const q = first(raw.q).slice(0, 200);
  const typeRaw = first(raw.type);
  const type = (LISTING_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as SearchParams["type"]) : undefined;
  const sortRaw = first(raw.sort);
  const sort: SearchSort = (SEARCH_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as SearchSort) : q ? "relevance" : "newest";
  const category = /^[a-z0-9-]{1,80}$/.test(first(raw.category)) ? first(raw.category) : undefined;
  const page = Math.min(200, Math.max(1, Number.parseInt(first(raw.page), 10) || 1));
  const inStock = first(raw.stock) === "1";

  const toSortCurrency = (text: string): number | undefined => {
    const minor = parseMoneyInput(text);
    if (minor === null) return undefined;
    return fx ? (convertMinor(minor, viewerCurrency, "USD", fx) ?? minor) : minor;
  };
  const minText = first(raw.min);
  const maxText = first(raw.max);

  const params: SearchParams = {
    q,
    type,
    category,
    minPrice: toSortCurrency(minText),
    maxPrice: toSortCurrency(maxText),
    inStock,
    sort,
    page,
    pageSize: PAGE_SIZE,
    ...fixed,
  };
  const echo: Record<string, string> = {};
  if (q) echo.q = q;
  if (type && !fixed.type) echo.type = type;
  if (category && !fixed.category) echo.category = category;
  if (sortRaw && sort === sortRaw) echo.sort = sort;
  if (parseMoneyInput(minText) !== null) echo.min = minText;
  if (parseMoneyInput(maxText) !== null) echo.max = maxText;
  if (inStock) echo.stock = "1";
  return { params, echo };
}
