import { prisma } from "@marketplace/database";

/**
 * Licence activation API for software sold as digital products. The key is
 * the credential; a device is identified by a fingerprint the vendor's app
 * computes. Re-activating the same device is free; new devices count against
 * the key's limit.
 */

export type LicenseResult =
  | { ok: true; status: "ACTIVE"; activationsUsed: number; activationsLimit: number; expiresAt: string | null; product: string }
  | { ok: false; code: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "LIMIT_REACHED" | "NOT_ACTIVATED"; message: string };

const MESSAGES = {
  NOT_FOUND: "This licence key is not valid.",
  REVOKED: "This licence key has been revoked.",
  EXPIRED: "This licence key has expired.",
  LIMIT_REACHED: "This licence key is active on the maximum number of devices. Deactivate one first.",
  NOT_ACTIVATED: "This device is not activated for this licence key.",
} as const;

function fail(code: keyof typeof MESSAGES): LicenseResult {
  return { ok: false, code, message: MESSAGES[code] };
}

async function loadKey(key: string, now: Date) {
  const license = await prisma.licenseKey.findUnique({
    where: { key: key.trim().toUpperCase() },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      activationsLimit: true,
      digitalAsset: { select: { listing: { select: { title: true } } } },
      activations: { where: { deactivatedAt: null }, select: { id: true, deviceFingerprint: true } },
    },
  });
  if (!license) return { found: false as const, result: fail("NOT_FOUND") };
  if (license.status === "REVOKED") return { found: false as const, result: fail("REVOKED") };
  if (license.status === "EXPIRED" || (license.expiresAt && license.expiresAt <= now)) return { found: false as const, result: fail("EXPIRED") };
  return { found: true as const, license };
}

export async function activateLicense(key: string, fingerprint: string, deviceName: string | null, ipAddress: string | null, now: Date): Promise<LicenseResult> {
  const loaded = await loadKey(key, now);
  if (!loaded.found) return loaded.result;
  const { license } = loaded;
  const existing = license.activations.find((activation) => activation.deviceFingerprint === fingerprint);
  if (!existing && license.activations.length >= license.activationsLimit) return fail("LIMIT_REACHED");

  await prisma.licenseActivation.upsert({
    where: { licenseKeyId_deviceFingerprint: { licenseKeyId: license.id, deviceFingerprint: fingerprint } },
    create: { licenseKeyId: license.id, deviceFingerprint: fingerprint, deviceName, ipAddress, activatedAt: now, lastSeenAt: now },
    update: { deactivatedAt: null, lastSeenAt: now, deviceName: deviceName ?? undefined, ipAddress },
  });
  return {
    ok: true,
    status: "ACTIVE",
    activationsUsed: existing ? license.activations.length : license.activations.length + 1,
    activationsLimit: license.activationsLimit,
    expiresAt: license.expiresAt?.toISOString() ?? null,
    product: license.digitalAsset.listing.title,
  };
}

export async function validateLicense(key: string, fingerprint: string, now: Date): Promise<LicenseResult> {
  const loaded = await loadKey(key, now);
  if (!loaded.found) return loaded.result;
  const { license } = loaded;
  const activation = license.activations.find((candidate) => candidate.deviceFingerprint === fingerprint);
  if (!activation) return fail("NOT_ACTIVATED");
  await prisma.licenseActivation.update({ where: { id: activation.id }, data: { lastSeenAt: now } });
  return {
    ok: true,
    status: "ACTIVE",
    activationsUsed: license.activations.length,
    activationsLimit: license.activationsLimit,
    expiresAt: license.expiresAt?.toISOString() ?? null,
    product: license.digitalAsset.listing.title,
  };
}

export async function deactivateLicense(key: string, fingerprint: string, now: Date): Promise<LicenseResult> {
  const loaded = await loadKey(key, now);
  if (!loaded.found) return loaded.result;
  const { license } = loaded;
  const activation = license.activations.find((candidate) => candidate.deviceFingerprint === fingerprint);
  if (!activation) return fail("NOT_ACTIVATED");
  await prisma.licenseActivation.update({ where: { id: activation.id }, data: { deactivatedAt: now } });
  return {
    ok: true,
    status: "ACTIVE",
    activationsUsed: license.activations.length - 1,
    activationsLimit: license.activationsLimit,
    expiresAt: license.expiresAt?.toISOString() ?? null,
    product: license.digitalAsset.listing.title,
  };
}
