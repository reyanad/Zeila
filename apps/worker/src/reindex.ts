import { prisma } from "@marketplace/database";
import { createSearchClient, ensureListingsIndex, reindexAll } from "@marketplace/search";
import { loadEnv } from "./env";
import { loadFxRates } from "./fx";

/** One-off full rebuild of the search index: `npm run reindex -w @marketplace/worker`. */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.MEILI_HOST || !env.MEILI_MASTER_KEY) throw new Error("Set MEILI_HOST and MEILI_MASTER_KEY to reindex");
  const client = createSearchClient({ host: env.MEILI_HOST, apiKey: env.MEILI_MASTER_KEY });
  await ensureListingsIndex(client);
  const count = await reindexAll(client, await loadFxRates());
  console.log(`Indexed ${count} public listings.`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
