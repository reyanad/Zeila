import { prisma, type LedgerAccountType, type Prisma } from "@marketplace/database";

/**
 * Immutable double-entry ledger.
 *
 * Every money movement is one JournalEntry with LedgerLines whose debits equal
 * credits per currency. Entries are never updated or deleted; a correction is
 * a new entry. Each entry has an idempotency key derived from the business
 * event (e.g. "order-paid:<orderId>"), so replays cannot double-post.
 *
 * Chart of accounts (one per currency):
 *   platform:cash:<CUR>              ASSET      money in the platform's Stripe balance
 *   platform:fees:<CUR>              INCOME     commission earned
 *   platform:promotions:<CUR>        EXPENSE    platform-funded discounts
 *   platform:refunds:<CUR>           EXPENSE    refunds the platform absorbs
 *   store:<id>:escrow:<CUR>          LIABILITY  owed to a store, held until release
 *   store:<id>:payable:<CUR>         LIABILITY  released, waiting for the Stripe transfer
 */

export interface AccountRef {
  code: string;
  name: string;
  type: LedgerAccountType;
  currency: string;
  storeId?: string;
}

export const accounts = {
  cash: (currency: string): AccountRef => ({ code: `platform:cash:${currency}`, name: `Platform cash (${currency})`, type: "ASSET", currency }),
  fees: (currency: string): AccountRef => ({ code: `platform:fees:${currency}`, name: `Commission income (${currency})`, type: "INCOME", currency }),
  promotions: (currency: string): AccountRef => ({ code: `platform:promotions:${currency}`, name: `Platform promotions (${currency})`, type: "EXPENSE", currency }),
  refunds: (currency: string): AccountRef => ({ code: `platform:refunds:${currency}`, name: `Refunds absorbed (${currency})`, type: "EXPENSE", currency }),
  escrow: (storeId: string, currency: string): AccountRef => ({ code: `store:${storeId}:escrow:${currency}`, name: `Escrow for store ${storeId} (${currency})`, type: "LIABILITY", currency, storeId }),
  payable: (storeId: string, currency: string): AccountRef => ({ code: `store:${storeId}:payable:${currency}`, name: `Payable to store ${storeId} (${currency})`, type: "LIABILITY", currency, storeId }),
};

export interface EntryLine {
  account: AccountRef;
  direction: "DEBIT" | "CREDIT";
  amount: number;
}

export interface JournalInput {
  idempotencyKey: string;
  description: string;
  occurredAt: Date;
  metadata?: Prisma.InputJsonObject;
  lines: EntryLine[];
}

export class UnbalancedEntryError extends Error {
  constructor(key: string, detail: string) {
    super(`Journal entry ${key} does not balance: ${detail}`);
    this.name = "UnbalancedEntryError";
  }
}

/** Validate an entry without touching the database (exported for tests). */
export function checkBalanced(input: JournalInput): EntryLine[] {
  const lines = input.lines.filter((line) => line.amount !== 0);
  for (const line of lines) {
    if (!Number.isInteger(line.amount) || line.amount < 0) {
      throw new UnbalancedEntryError(input.idempotencyKey, `amount ${line.amount} on ${line.account.code} must be a positive integer`);
    }
  }
  if (lines.length < 2) throw new UnbalancedEntryError(input.idempotencyKey, "needs at least two non-zero lines");
  const totals = new Map<string, number>();
  for (const line of lines) {
    const signed = line.direction === "DEBIT" ? line.amount : -line.amount;
    totals.set(line.account.currency, (totals.get(line.account.currency) ?? 0) + signed);
  }
  for (const [currency, total] of totals) {
    if (total !== 0) throw new UnbalancedEntryError(input.idempotencyKey, `${currency} debits and credits differ by ${total}`);
  }
  return lines;
}

/**
 * Post a balanced entry inside the caller's transaction. Returns false if an
 * entry with the same idempotency key already exists (nothing is written).
 */
export async function postEntry(tx: Prisma.TransactionClient, input: JournalInput): Promise<boolean> {
  const lines = checkBalanced(input);
  const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return false;

  const accountIds = new Map<string, string>();
  for (const { account } of lines) {
    if (accountIds.has(account.code)) continue;
    const row = await tx.ledgerAccount.upsert({
      where: { code: account.code },
      create: { code: account.code, name: account.name, type: account.type, currency: account.currency, storeId: account.storeId ?? null },
      update: {},
      select: { id: true },
    });
    accountIds.set(account.code, row.id);
  }

  await tx.journalEntry.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
      lines: {
        create: lines.map((line) => ({
          accountId: accountIds.get(line.account.code) as string,
          direction: line.direction,
          amount: line.amount,
          currency: line.account.currency,
        })),
      },
    },
  });
  return true;
}

export interface AccountBalance {
  code: string;
  name: string;
  type: LedgerAccountType;
  currency: string;
  /** In the account's natural direction: positive means "has" (assets, expenses) or "owes" (liabilities, income). */
  balance: number;
}

const DEBIT_NATURAL: ReadonlySet<LedgerAccountType> = new Set(["ASSET", "EXPENSE"]);

/** Balances for accounts matching a code prefix, e.g. "store:<id>:" or "platform:". */
export async function balancesByPrefix(prefix: string): Promise<AccountBalance[]> {
  const rows = await prisma.ledgerAccount.findMany({ where: { code: { startsWith: prefix } }, select: { id: true, code: true, name: true, type: true, currency: true } });
  if (rows.length === 0) return [];
  const sums = await prisma.ledgerLine.groupBy({ by: ["accountId", "direction"], where: { accountId: { in: rows.map((row) => row.id) } }, _sum: { amount: true } });
  return rows.map((row) => {
    const debit = sums.find((sum) => sum.accountId === row.id && sum.direction === "DEBIT")?._sum.amount ?? 0;
    const credit = sums.find((sum) => sum.accountId === row.id && sum.direction === "CREDIT")?._sum.amount ?? 0;
    return { code: row.code, name: row.name, type: row.type, currency: row.currency, balance: DEBIT_NATURAL.has(row.type) ? debit - credit : credit - debit };
  });
}

/** Trial balance per currency: total debits minus total credits across all lines (must be 0). */
export async function trialBalance(): Promise<Array<{ currency: string; difference: number }>> {
  const sums = await prisma.ledgerLine.groupBy({ by: ["currency", "direction"], _sum: { amount: true } });
  const currencies = [...new Set(sums.map((sum) => sum.currency))];
  return currencies.map((currency) => {
    const debit = sums.find((sum) => sum.currency === currency && sum.direction === "DEBIT")?._sum.amount ?? 0;
    const credit = sums.find((sum) => sum.currency === currency && sum.direction === "CREDIT")?._sum.amount ?? 0;
    return { currency, difference: debit - credit };
  });
}
