import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import Stripe from "stripe";
import { expireStaleOrders, processDisputeDeadlines, releaseEligibleEscrows, settleReferrals, transferPendingPayouts } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, WORKER_REDIS_OPTIONS, type MaintenanceJob, type NotificationJob, type SearchJob } from "@marketplace/jobs";
import { createSearchClient, ensureListingsIndex } from "@marketplace/search";
import { loadEnv } from "./env";
import { refreshFxRates } from "./fx";
import { notificationProcessor } from "./jobs/notifications";
import { searchProcessor } from "./jobs/search";

/**
 * Background worker: search index and embeddings, exchange rates, unpaid
 * order expiry, escrow release and payouts, dispute deadlines, and e-mail for
 * notifications and unread messages.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const connection = new Redis(env.REDIS_URL, WORKER_REDIS_OPTIONS);

  const meili = env.MEILI_HOST && env.MEILI_MASTER_KEY ? createSearchClient({ host: env.MEILI_HOST, apiKey: env.MEILI_MASTER_KEY }) : null;
  if (meili) await ensureListingsIndex(meili);
  else console.warn("[worker] MEILI_HOST/MEILI_MASTER_KEY not set: search indexing disabled (storefront uses database search)");

  const embeddings =
    env.EMBEDDINGS_API_URL && env.EMBEDDINGS_API_KEY
      ? { url: env.EMBEDDINGS_API_URL, apiKey: env.EMBEDDINGS_API_KEY, model: env.EMBEDDINGS_MODEL }
      : null;
  if (!embeddings) console.warn("[worker] EMBEDDINGS_API_URL/EMBEDDINGS_API_KEY not set: similar listings use category fallback");

  const searchWorker = new Worker<SearchJob, string>(QUEUE_NAMES.search, searchProcessor({ meili, embeddings }), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  });

  const searchQueue = new Queue<SearchJob>(QUEUE_NAMES.search, { connection });
  const maintenanceQueue = new Queue<MaintenanceJob>(QUEUE_NAMES.maintenance, { connection });
  const stripe = env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.endsWith("_xxx") ? new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 }) : null;
  await maintenanceQueue.upsertJobScheduler(
    "expire-orders",
    { every: 5 * 60_000 },
    { name: "expire-orders", data: { kind: "expire-orders" }, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } },
  );
  await maintenanceQueue.upsertJobScheduler(
    "release-escrow",
    { every: 10 * 60_000 },
    { name: "release-escrow", data: { kind: "release-escrow" }, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } },
  );
  await maintenanceQueue.upsertJobScheduler(
    "dispute-deadlines",
    { every: 30 * 60_000 },
    { name: "disputes", data: { kind: "disputes" }, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } },
  );
  await maintenanceQueue.upsertJobScheduler(
    "fx-rates-daily",
    { pattern: "17 3 * * *" },
    { name: "fx-rates", data: { kind: "fx-rates" }, opts: DEFAULT_JOB_OPTIONS },
  );

  const maintenanceWorker = new Worker<MaintenanceJob, string>(
    QUEUE_NAMES.maintenance,
    async (job) => {
      switch (job.data.kind) {
        case "expire-orders": {
          const cancelled = await expireStaleOrders(stripe, new Date());
          return `expired ${cancelled} unpaid orders`;
        }
        case "release-escrow": {
          const now = new Date();
          const released = await releaseEligibleEscrows(now);
          const transferred = stripe ? await transferPendingPayouts(stripe) : 0;
          const referrals = await settleReferrals(now);
          return `released ${released} escrows, transferred ${transferred}${stripe ? "" : " (Stripe not configured)"}, referrals ${referrals.approved} approved / ${referrals.reversed} reversed`;
        }
        case "disputes": {
          const result = await processDisputeDeadlines(new Date());
          return `disputes: ${result.escalated} escalated, ${result.closed} closed`;
        }
        case "fx-rates": {
          const fx = await refreshFxRates(env.FX_RATES_URL);
          // Cross-currency sort prices depend on the rates.
          await searchQueue.add("all", { kind: "all" }, { ...DEFAULT_JOB_OPTIONS, jobId: "all" });
          return `rates for ${Object.keys(fx.rates).length} currencies`;
        }
      }
    },
    { connection, concurrency: 1 },
  );

  const notificationWorker = new Worker<NotificationJob, string>(
    QUEUE_NAMES.notifications,
    notificationProcessor({ expoAccessToken: env.EXPO_ACCESS_TOKEN, resendApiKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM, appUrl: env.NEXT_PUBLIC_APP_URL, brand: env.APP_NAME }),
    { connection, concurrency: Math.min(env.WORKER_CONCURRENCY, 4) },
  );
  if (!env.RESEND_API_KEY) console.warn("[worker] RESEND_API_KEY not set: notification e-mails are logged, not sent");

  for (const worker of [searchWorker, maintenanceWorker, notificationWorker]) {
    worker.on("failed", (job, error) => console.error(`[worker] ${worker.name}/${job?.name ?? "?"} ${job?.id ?? ""} failed: ${error.message}`));
    worker.on("completed", (job, result) => console.log(`[worker] ${worker.name}/${job.name} ${job.id ?? ""}: ${String(result)}`));
  }
  console.log(`[worker] running (concurrency ${env.WORKER_CONCURRENCY})`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, finishing current jobs`);
    await Promise.allSettled([searchWorker.close(), maintenanceWorker.close(), notificationWorker.close(), searchQueue.close(), maintenanceQueue.close()]);
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
