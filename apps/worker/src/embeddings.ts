import { createHash } from "node:crypto";
import { prisma } from "@marketplace/database";
import { z } from "zod";

export interface EmbeddingsConfig {
  url: string;
  apiKey: string;
  model: string;
}

const EMBEDDING_DIMENSIONS = 1536;

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })).min(1),
});

function embeddingText(listing: { title: string; summary: string | null; tags: string[]; description: string }): string {
  return [listing.title, listing.summary ?? "", listing.tags.join(", "), listing.description.slice(0, 3_000)].join("\n").trim();
}

/**
 * Embed a listing's text with an OpenAI-compatible /embeddings endpoint and
 * store the vector for "similar listings". Unchanged text is skipped.
 */
export async function embedListing(config: EmbeddingsConfig, listingId: string): Promise<"embedded" | "unchanged" | "missing"> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, title: true, summary: true, tags: true, description: true, embeddingHash: true },
  });
  if (!listing) return "missing";

  const text = embeddingText(listing);
  const hash = createHash("sha256").update(`${config.model}\n${text}`).digest("hex");
  if (listing.embeddingHash === hash) return "unchanged";

  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, input: text, dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Embeddings API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const vector = responseSchema.parse(await response.json()).data[0]?.embedding ?? [];
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding has ${vector.length} dimensions; the column expects ${EMBEDDING_DIMENSIONS}`);
  }

  const literal = `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
  await prisma.$executeRaw`UPDATE "Listing" SET "embedding" = ${literal}::vector, "embeddingHash" = ${hash}, "embeddedAt" = NOW() WHERE "id" = ${listing.id}`;
  return "embedded";
}
