import "server-only";
import { z } from "zod";
import type { LicenseResult } from "@marketplace/core";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request";

const bodySchema = z.object({
  key: z.string().trim().min(8).max(100),
  fingerprint: z.string().trim().min(8, "fingerprint must identify the device").max(200),
  deviceName: z.string().trim().max(100).optional(),
});

/**
 * Shared handling for the licence API: JSON in, JSON out, rate-limited per
 * IP. 200 for valid results, 4xx with `{ ok: false, code, message }` otherwise.
 */
export async function handleLicenseRequest(
  request: Request,
  run: (input: z.infer<typeof bodySchema>, ip: string) => Promise<LicenseResult>,
): Promise<Response> {
  const ip = clientIpFromHeaders(request.headers);
  const limit = await rateLimit(`license-api:${ip}`, 60, 60);
  if (!limit.allowed) {
    return Response.json({ ok: false, code: "RATE_LIMITED", message: `Too many requests. ${describeRetry(limit.retryAfterSeconds)}` }, { status: 429 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ ok: false, code: "BAD_REQUEST", message: "Send a JSON body with key and fingerprint." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ ok: false, code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const result = await run(parsed.data, ip);
  const status = result.ok ? 200 : result.code === "NOT_FOUND" ? 404 : result.code === "LIMIT_REACHED" ? 409 : 403;
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
