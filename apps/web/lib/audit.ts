import "server-only";
import { prisma, type Prisma } from "@marketplace/database";

export interface AuditEntry {
  actorId: string | null;
  /** Dotted verb, e.g. "auth.2fa.enable", "kyc.submit", "payout.account.update". */
  action: string;
  entity: string;
  entityId: string;
  data?: Prisma.InputJsonObject;
  ipAddress?: string | null;
}

/**
 * Append to the audit trail. Failures are logged, never thrown: an audit
 * outage must not block the user-facing operation that already succeeded.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        data: entry.data ?? {},
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error(`[audit] failed to record ${entry.action} for ${entry.entity}:${entry.entityId}`, error);
  }
}
