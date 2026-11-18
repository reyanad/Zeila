"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { encryptAtRest } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import {
  createStoreSchema,
  fieldErrors,
  KYC_DOCUMENT_CONTENT_TYPES,
  KYC_DOCUMENT_KINDS,
  KYC_DOCUMENT_MAX_BYTES,
  kycSubmissionSchema,
  payoutAccountSchema,
  type KycDocument,
} from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { chapaErrorMessage, getChapa, payoutBanks } from "@/lib/chapa";
import { encryptField } from "@/lib/crypto/encryption";
import { isUniqueViolation } from "@/lib/db-errors";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { syncStoreStatus } from "@/lib/seller/status";
import { deleteVaultObject, putVaultObject } from "@/lib/storage";
import { EXTENSION_BY_TYPE, readUpload } from "@/lib/uploads";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Text inputs to echo back when a form is rejected (never files or secrets). */
function echo(formData: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name).slice(0, 200)]));
}

const STORE_FIELDS = ["name", "slug", "country", "currency", "tagline"] as const;
const KYC_FIELDS = ["legalName", "birthDate", "country", "idType"] as const;

const ONBOARDING_PATH = "/seller/onboarding";

// ---------------------------------------------------------------------------
// Step 1: open a store
// ---------------------------------------------------------------------------

export async function createStoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize();
  if (!auth.ok) return formError(auth.message);
  const user = auth.user;
  if (!user.emailVerified) return formError("Confirm your email address before opening a store.");
  if (user.role === "MODERATOR") return formError("Staff accounts cannot open stores.");

  const parsed = createStoreSchema.safeParse({
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    country: text(formData, "country"),
    currency: text(formData, "currency"),
    tagline: text(formData, "tagline"),
  });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", fieldErrors(parsed.error), echo(formData, STORE_FIELDS));
  }
  const input = parsed.data;

  const existing = await prisma.store.findUnique({ where: { sellerId: user.id }, select: { id: true } });
  if (existing) return formError("You already have a store.");
  const slugTaken = await prisma.store.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (slugTaken) {
    return formError("Check the highlighted fields.", { slug: "That store address is taken" }, echo(formData, STORE_FIELDS));
  }

  let storeId: string;
  try {
    storeId = await prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          sellerId: user.id,
          name: input.name,
          slug: input.slug,
          country: input.country,
          currency: input.currency,
          tagline: input.tagline.length > 0 ? input.tagline : null,
          status: "DRAFT",
        },
        select: { id: true },
      });
      // Buyers become sellers; a super admin keeps their role.
      if (user.role === "BUYER") await tx.user.update({ where: { id: user.id }, data: { role: "SELLER" } });
      return store.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return formError("Check the highlighted fields.", { slug: "That store address is taken" }, echo(formData, STORE_FIELDS));
    }
    throw error;
  }

  await recordAudit({
    actorId: user.id,
    action: "store.create",
    entity: "Store",
    entityId: storeId,
    data: { slug: input.slug, country: input.country },
    ipAddress: await getClientIp(),
  });
  revalidatePath(ONBOARDING_PATH);
  revalidatePath("/account");
  return formSuccess("Your store is open. Next, verify your identity.");
}

// ---------------------------------------------------------------------------
// Step 2: identity verification (KYC)
// ---------------------------------------------------------------------------

export async function submitKycAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize("kyc:submit");
  if (!auth.ok) return formError(auth.message);
  const user = auth.user;
  if (!user.emailVerified) return formError("Confirm your email address first.");

  const limit = await rateLimit(`kyc-submit:${user.id}`, 5, 60 * 60);
  if (!limit.allowed) return formError(`Too many attempts. ${describeRetry(limit.retryAfterSeconds)}`);

  const store = await prisma.store.findUnique({ where: { sellerId: user.id }, select: { id: true } });
  if (!store) return formError("Open your store before verifying your identity.");

  const latest = await prisma.kycSubmission.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (latest?.status === "PENDING") return formError("Your documents are already being reviewed.");
  if (latest?.status === "APPROVED") return formError("Your identity is already verified.");

  // Check every file before anything is stored, so a rejected form leaves no orphans.
  const submissionId = randomUUID();
  const uploads: Array<{ doc: KycDocument; bytes: Uint8Array }> = [];
  const fileErrors: Record<string, string> = {};
  for (const kind of KYC_DOCUMENT_KINDS) {
    const entry = formData.get(kind);
    if (!(entry instanceof File) || entry.size === 0) continue;
    const checked = await readUpload(entry, KYC_DOCUMENT_MAX_BYTES, KYC_DOCUMENT_CONTENT_TYPES);
    if (!checked.ok) {
      fileErrors[kind] = checked.message;
      continue;
    }
    const extension = EXTENSION_BY_TYPE[checked.contentType];
    uploads.push({
      bytes: checked.bytes,
      doc: {
        kind,
        storageKey: `kyc/${user.id}/${submissionId}/${kind}-${randomBytes(6).toString("hex")}.${extension}`,
        fileName: checked.fileName,
        contentType: checked.contentType,
        size: checked.bytes.byteLength,
      },
    });
  }

  const parsed = kycSubmissionSchema.safeParse({
    legalName: text(formData, "legalName"),
    birthDate: text(formData, "birthDate"),
    country: text(formData, "country"),
    idType: text(formData, "idType"),
    idNumber: text(formData, "idNumber"),
    documents: uploads.map((upload) => upload.doc),
  });
  if (!parsed.success || Object.keys(fileErrors).length > 0) {
    const fields = { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...fileErrors };
    return formError("Check the highlighted fields.", fields, echo(formData, KYC_FIELDS));
  }
  const input = parsed.data;

  const stored: string[] = [];
  try {
    for (const upload of uploads) {
      await putVaultObject(upload.doc.storageKey, upload.bytes, upload.doc.contentType);
      stored.push(upload.doc.storageKey);
    }
    await prisma.kycSubmission.create({
      data: {
        id: submissionId,
        userId: user.id,
        status: "PENDING",
        legalName: input.legalName,
        birthDate: new Date(`${input.birthDate}T00:00:00Z`),
        country: input.country,
        idType: input.idType,
        idNumber: encryptField(input.idNumber.toUpperCase()),
        documents: input.documents,
      },
    });
  } catch (error) {
    await Promise.allSettled(stored.map((key) => deleteVaultObject(key)));
    console.error("[kyc] could not store submission", error);
    return formError("We could not save your documents. Try again in a few minutes.");
  }

  await syncStoreStatus(store.id);
  await recordAudit({
    actorId: user.id,
    action: "kyc.submit",
    entity: "KycSubmission",
    entityId: submissionId,
    data: { documents: input.documents.map((doc) => doc.kind), country: input.country },
    ipAddress: await getClientIp(),
  });
  revalidatePath(ONBOARDING_PATH);
  return formSuccess("Documents received. Review usually takes one to two business days.");
}

// ---------------------------------------------------------------------------
// Step 3: payout account (Chapa transfers to a bank account or mobile wallet)
// ---------------------------------------------------------------------------

const PAYOUT_FIELDS = ["bankId", "accountName"] as const;

export async function savePayoutAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize("store:manage");
  if (!auth.ok) return formError(auth.message);
  const values = Object.fromEntries(PAYOUT_FIELDS.map((name) => [name, text(formData, name)]));

  if (!getChapa()) return formError("Payouts are not available yet: the platform has not finished its Chapa setup.", undefined, values);
  const limit = await rateLimit(`payout-account:${auth.user.id}`, 10, 60 * 60);
  if (!limit.allowed) return formError(`Too many changes. ${describeRetry(limit.retryAfterSeconds)}`, undefined, values);

  const parsed = payoutAccountSchema.safeParse({
    bankId: text(formData, "bankId"),
    accountName: text(formData, "accountName"),
    accountNumber: text(formData, "accountNumber"),
    confirmAccountNumber: text(formData, "confirmAccountNumber"),
  });
  if (!parsed.success) return formError("Check the highlighted fields.", fieldErrors(parsed.error), values);
  const input = parsed.data;

  const store = await prisma.store.findUnique({ where: { sellerId: auth.user.id }, select: { id: true } });
  if (!store) return formError("Open your store first.", undefined, values);

  let bank;
  try {
    bank = (await payoutBanks()).find((candidate) => candidate.id === input.bankId);
  } catch (error) {
    console.error("[payouts] could not load Chapa banks", error);
    return formError(chapaErrorMessage(error), undefined, values);
  }
  if (!bank) return formError("Check the highlighted fields.", { bankId: "Choose a bank or wallet from the list" }, values);
  if (bank.accountLength !== null && input.accountNumber.length !== bank.accountLength) {
    const kind = bank.isMobileMoney ? "phone numbers" : "account numbers";
    return formError("Check the highlighted fields.", { accountNumber: `${bank.name} ${kind} have ${bank.accountLength} digits` }, values);
  }

  await prisma.store.update({
    where: { id: store.id },
    data: {
      payoutBankId: bank.id,
      payoutBankName: bank.name,
      payoutAccountName: input.accountName,
      payoutAccountNumber: encryptAtRest(input.accountNumber),
      payoutAccountLast4: input.accountNumber.slice(-4),
      payoutAccountUpdatedAt: new Date(),
      payoutsEnabled: true,
    },
  });
  await syncStoreStatus(store.id);
  await recordAudit({
    actorId: auth.user.id,
    action: "payout.account.update",
    entity: "Store",
    entityId: store.id,
    data: { bank: bank.name, last4: input.accountNumber.slice(-4), mobileMoney: bank.isMobileMoney },
    ipAddress: await getClientIp(),
  });
  revalidatePath(ONBOARDING_PATH);
  return formSuccess(`Payouts will go to ${bank.name}, ending ${input.accountNumber.slice(-4)}.`);
}
