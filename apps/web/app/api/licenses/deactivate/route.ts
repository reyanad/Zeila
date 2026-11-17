import { deactivateLicense } from "@marketplace/core";
import { handleLicenseRequest } from "@/lib/license-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key, fingerprint }: free this device's activation slot. */
export async function POST(request: Request): Promise<Response> {
  return handleLicenseRequest(request, (input) => deactivateLicense(input.key, input.fingerprint, new Date()));
}
