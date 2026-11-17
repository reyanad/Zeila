import { activateLicense } from "@marketplace/core";
import { handleLicenseRequest } from "@/lib/license-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key, fingerprint, deviceName? }: activate this device for the licence key. */
export async function POST(request: Request): Promise<Response> {
  return handleLicenseRequest(request, (input, ip) => activateLicense(input.key, input.fingerprint, input.deviceName ?? null, ip, new Date()));
}
