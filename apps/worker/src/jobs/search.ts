import type { Job } from "bullmq";
import type { Meilisearch } from "meilisearch";
import type { SearchJob } from "@marketplace/jobs";
import { reindexAll, syncListing, syncStore } from "@marketplace/search";
import { embedListing, type EmbeddingsConfig } from "../embeddings";
import { loadFxRates } from "../fx";

export interface SearchDeps {
  meili: Meilisearch | null;
  embeddings: EmbeddingsConfig | null;
}

export function searchProcessor(deps: SearchDeps) {
  return async (job: Job<SearchJob>): Promise<string> => {
    const fx = await loadFxRates();
    const data = job.data;
    switch (data.kind) {
      case "listing": {
        const results: string[] = [];
        if (deps.meili) results.push(`index:${await syncListing(deps.meili, data.listingId, fx)}`);
        if (deps.embeddings) results.push(`embedding:${await embedListing(deps.embeddings, data.listingId)}`);
        return results.join(" ") || "skipped: no search or embeddings configured";
      }
      case "store":
        return deps.meili ? `store listings synced: ${await syncStore(deps.meili, data.storeId, fx)}` : "skipped";
      case "all":
        return deps.meili ? `reindexed: ${await reindexAll(deps.meili, fx)}` : "skipped";
    }
  };
}
