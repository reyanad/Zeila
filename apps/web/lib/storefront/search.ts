import "server-only";
import { createSearchClient, searchListings, type SearchParams, type SearchResult } from "@marketplace/search";
import { meiliSettings } from "@/lib/env";

export function storefrontSearchClient() {
  const settings = meiliSettings();
  return settings ? createSearchClient(settings) : null;
}

export async function runSearch(params: SearchParams): Promise<SearchResult> {
  return searchListings(params, storefrontSearchClient());
}
