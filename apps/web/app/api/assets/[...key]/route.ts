import { assertValidKey, getStorage } from "@/lib/storage";

export const runtime = "nodejs";

const ALLOWED_PREFIXES = ["listing-images/"] as const;

/**
 * Serves objects from the public bucket when no CDN domain is configured
 * (PUBLIC_ASSET_BASE_URL). Keys are random and never reused, so responses
 * are cacheable forever.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const { key: segments } = await params;
  const key = segments.join("/");
  try {
    assertValidKey(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) || !key.endsWith(".webp")) {
    return new Response("Not found", { status: 404 });
  }
  const body = await getStorage().get("public", key);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
