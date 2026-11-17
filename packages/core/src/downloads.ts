import { prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";

export interface DownloadTarget {
  grantId: string;
  vaultKey: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Authorise one download for the buyer and count it against the limit. The
 * caller turns the result into a short-lived signed link.
 */
export async function issueDownload(buyerId: string, grantId: string, now: Date): Promise<DownloadTarget> {
  const grant = await prisma.downloadGrant.findFirst({
    where: { id: grantId, orderItem: { subOrder: { order: { buyerId } } } },
    select: {
      id: true,
      downloadsUsed: true,
      digitalAsset: { select: { vaultKey: true, fileName: true, sizeBytes: true, downloadLimit: true } },
      orderItem: { select: { status: true, subOrder: { select: { status: true } } } },
    },
  });
  if (!grant) throw new CheckoutError("That download does not exist.");
  if (grant.orderItem.status === "REFUNDED" || grant.orderItem.subOrder.status === "REFUNDED") throw new CheckoutError("This purchase was refunded.");

  const limit = grant.digitalAsset.downloadLimit;
  const counted = await prisma.downloadGrant.updateMany({
    where: { id: grant.id, ...(limit !== null ? { downloadsUsed: { lt: limit } } : {}) },
    data: { downloadsUsed: { increment: 1 }, lastDownloadAt: now },
  });
  if (counted.count === 0) throw new CheckoutError("You have used all downloads for this purchase. Contact the seller for help.");
  return { grantId: grant.id, vaultKey: grant.digitalAsset.vaultKey, fileName: grant.digitalAsset.fileName, sizeBytes: Number(grant.digitalAsset.sizeBytes) };
}
