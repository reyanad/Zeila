import type { Meilisearch } from "meilisearch";
import { prisma } from "@marketplace/database";
import type { FxRates } from "@marketplace/shared-types";
import { LISTINGS_INDEX, LISTINGS_SETTINGS } from "./client";
import { buildListingDocument, listingIndexInclude, loadPublicListing } from "./documents";
import { publicListingWhere } from "./visibility";

const BATCH_SIZE = 500;

export async function ensureListingsIndex(client: Meilisearch): Promise<void> {
  await client.createIndex(LISTINGS_INDEX, { primaryKey: "id" }).waitTask().catch((error: unknown) => {
    // index_already_exists is expected on every start after the first.
    if (!(error instanceof Error && error.message.includes("already exists"))) throw error;
  });
  await client
    .index(LISTINGS_INDEX)
    .updateSettings({
      ...LISTINGS_SETTINGS,
      searchableAttributes: [...LISTINGS_SETTINGS.searchableAttributes],
      filterableAttributes: [...LISTINGS_SETTINGS.filterableAttributes],
      sortableAttributes: [...LISTINGS_SETTINGS.sortableAttributes],
      rankingRules: [...LISTINGS_SETTINGS.rankingRules],
    })
    .waitTask();
}

/** Add, update or remove one listing so the index matches the database. */
export async function syncListing(client: Meilisearch, listingId: string, fx: FxRates | null): Promise<"indexed" | "removed"> {
  const listing = await loadPublicListing(listingId);
  const index = client.index(LISTINGS_INDEX);
  if (!listing) {
    await index.deleteDocument(listingId).waitTask();
    return "removed";
  }
  await index.addDocuments([buildListingDocument(listing, fx)]).waitTask();
  return "indexed";
}

/** Re-sync every listing of a store (after the store is activated, suspended or renamed). */
export async function syncStore(client: Meilisearch, storeId: string, fx: FxRates | null): Promise<number> {
  const ids = await prisma.listing.findMany({ where: { storeId }, select: { id: true } });
  for (const { id } of ids) await syncListing(client, id, fx);
  return ids.length;
}

/** Rebuild the whole index: upsert every public listing, drop documents that are no longer public. */
export async function reindexAll(client: Meilisearch, fx: FxRates | null): Promise<number> {
  const index = client.index(LISTINGS_INDEX);
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.listing.findMany({
      where: publicListingWhere,
      include: listingIndexInclude,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    await index.addDocuments(batch.map((listing) => buildListingDocument(listing, fx))).waitTask();
    for (const listing of batch) seen.add(listing.id);
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  // Remove stale documents in pages.
  let offset = 0;
  const stale: string[] = [];
  for (;;) {
    const page = await index.getDocuments<{ id: string }>({ fields: ["id"], limit: 1_000, offset });
    for (const document of page.results) if (!seen.has(document.id)) stale.push(document.id);
    offset += page.results.length;
    if (page.results.length < 1_000) break;
  }
  if (stale.length > 0) await index.deleteDocuments(stale).waitTask();
  return seen.size;
}
