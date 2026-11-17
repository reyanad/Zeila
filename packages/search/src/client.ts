import { Meilisearch } from "meilisearch";

export const LISTINGS_INDEX = "listings";

export interface SearchConfig {
  host: string;
  apiKey: string;
}

const clients = new Map<string, Meilisearch>();

export function createSearchClient(config: SearchConfig): Meilisearch {
  const cacheKey = `${config.host}|${config.apiKey}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new Meilisearch({ host: config.host, apiKey: config.apiKey, timeout: 5_000 });
    clients.set(cacheKey, client);
  }
  return client;
}

/** Index settings, applied idempotently by the worker at start-up. */
export const LISTINGS_SETTINGS = {
  searchableAttributes: ["title", "tags", "summary", "storeName", "description"],
  filterableAttributes: ["type", "categorySlugs", "storeId", "storeSlug", "currency", "sortPrice", "inStock", "storeCountry", "ratingAvg"],
  sortableAttributes: ["sortPrice", "publishedAt", "ratingAvg", "salesCount"],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness", "salesCount:desc"],
  typoTolerance: { minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  pagination: { maxTotalHits: 5_000 },
} as const;
