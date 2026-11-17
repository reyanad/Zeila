import { Queue, type JobsOptions } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";

/**
 * Queue names and payloads shared by producers (web) and consumers (worker).
 * Keep payloads small: workers re-read current state from the database.
 */
export const QUEUE_NAMES = {
  search: "search-index",
  maintenance: "maintenance",
  notifications: "notifications",
} as const;

export type SearchJob =
  | { kind: "listing"; listingId: string }
  | { kind: "store"; storeId: string }
  | { kind: "all" };

export type MaintenanceJob = { kind: "fx-rates" } | { kind: "expire-orders" } | { kind: "release-escrow" } | { kind: "disputes" };

export type NotificationJob =
  | { kind: "notification-email"; notificationId: string }
  /** Sent a few minutes after a message, only if it is still unread. */
  | { kind: "message-email"; conversationId: string; recipientId: string };

/** Options for connections used by BullMQ workers (blocking commands need no retry cap). */
export const WORKER_REDIS_OPTIONS: RedisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false };

/** Producers fail fast when Redis is down instead of queueing commands in memory. */
const PRODUCER_REDIS_OPTIONS: RedisOptions = { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 };

const producers = new Map<string, { connection: Redis; queues: Map<string, Queue> }>();

function producerQueue<T>(redisUrl: string, name: string): Queue<T> {
  let entry = producers.get(redisUrl);
  if (!entry) {
    const connection = new Redis(redisUrl, PRODUCER_REDIS_OPTIONS);
    connection.on("error", (error: Error) => console.error(`[jobs] Redis connection error: ${error.message}`));
    entry = { connection, queues: new Map() };
    producers.set(redisUrl, entry);
  }
  let queue = entry.queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: entry.connection });
    entry.queues.set(name, queue);
  }
  return queue as Queue<T>;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  // Completed jobs are dropped so the same job id can be queued again later.
  removeOnComplete: true,
  removeOnFail: 1_000,
};

function searchJobId(job: SearchJob): string {
  switch (job.kind) {
    case "listing":
      return `listing-${job.listingId}`;
    case "store":
      return `store-${job.storeId}`;
    case "all":
      return "all";
  }
}

/**
 * Queue a search sync. Jobs for the same entity are de-duplicated while
 * waiting: the worker reads the latest state when it runs. Returns false
 * when Redis is unreachable, so callers can fall back to syncing inline.
 */
export async function enqueueSearchJob(redisUrl: string, job: SearchJob): Promise<boolean> {
  try {
    await producerQueue<SearchJob>(redisUrl, QUEUE_NAMES.search).add(job.kind, job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: searchJobId(job),
      delay: job.kind === "listing" ? 1_000 : 0,
    });
    return true;
  } catch (error) {
    console.error("[jobs] could not enqueue search job", error);
    return false;
  }
}

export { DEFAULT_JOB_OPTIONS };

/** Queue e-mail delivery for notifications and unread messages. Returns false when Redis is unreachable. */
export async function enqueueNotificationJob(redisUrl: string, job: NotificationJob): Promise<boolean> {
  try {
    const jobId = job.kind === "notification-email" ? `notification-${job.notificationId}` : `message-${job.conversationId}-${job.recipientId}`;
    await producerQueue<NotificationJob>(redisUrl, QUEUE_NAMES.notifications).add(job.kind, job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId,
      delay: job.kind === "message-email" ? 5 * 60_000 : 0,
    });
    return true;
  } catch (error) {
    console.error("[jobs] could not enqueue notification job", error);
    return false;
  }
}
