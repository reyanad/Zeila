import { validateLicense } from "@marketplace/core";
import { handleLicenseRequest } from "@/lib/license-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key, fingerprint }: is this device activated and the key still valid? */
export async function POST(request: Request): Promise<Response> {
  return handleLicenseRequest(request, (input) => validateLicense(input.key, input.fingerprint, new Date()));
}
