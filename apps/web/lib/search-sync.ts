import "server-only";
import { after } from "next/server";
import { enqueueSearchJob, type SearchJob } from "@marketplace/jobs";
import { syncListing, syncStore } from "@marketplace/search";
import { getEnv } from "@/lib/env";
import { getFxRates } from "@/lib/storefront/fx";
import { storefrontSearchClient } from "@/lib/storefront/search";

async function run(job: SearchJob): Promise<void> {
  const redisUrl = getEnv().REDIS_URL;
  if (redisUrl && (await enqueueSearchJob(redisUrl, job))) return;

  // No queue available: keep the index current directly (best effort).
  const client = storefrontSearchClient();
  if (!client || job.kind === "all") return;
  try {
    const fx = await getFxRates();
    if (job.kind === "listing") await syncListing(client, job.listingId, fx);
    else await syncStore(client, job.storeId, fx);
  } catch (error) {
    console.error("[search] inline sync failed", error);
  }
}

/** Sync the search index after the current response is sent. */
export function scheduleSearchSync(job: SearchJob): void {
  after(() => run(job));
}
