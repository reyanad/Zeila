import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

/**
 * Singleton PrismaClient (Prisma 7, Rust-free client + pg driver adapter).
 *
 * The client is created on first use rather than at import time, so builds
 * and type checks never need DATABASE_URL. It is stashed on globalThis so
 * Next.js hot-reload (which re-evaluates modules) does not open a new
 * connection pool on every change.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { PrismaClient, Prisma } from "./generated/client";
export * from "./generated/enums";
// Plain row types (`User`, `Store`, ...) and the per-model helper types.
export type * from "./generated/client";
export type * from "./generated/models";
