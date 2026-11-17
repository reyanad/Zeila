import "server-only";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { prisma, type User } from "@marketplace/database";

/**
 * Auth.js adapter over the marketplace schema. The stock Prisma adapter
 * expects a model named `Account`; ours is `OauthAccount`, so the handful of
 * methods OAuth sign-in needs are implemented here. Sessions are stateless
 * JWTs, so the database-session methods are intentionally not provided.
 */

function toAdapterUser(user: User): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

export function createAuthAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, "id">) {
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          // OAuth providers only reach this point with a verified address
          // (enforced in the signIn callback).
          emailVerified: data.emailVerified ?? new Date(),
          name: data.name ?? null,
          image: data.image ?? null,
        },
      });
      return toAdapterUser(user);
    },

    async getUser(id) {
      const user = await prisma.user.findUnique({ where: { id } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await prisma.oauthAccount.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser(data) {
      const user = await prisma.user.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.image !== undefined ? { image: data.image } : {}),
          ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
        },
      });
      return toAdapterUser(user);
    },

    async deleteUser(id) {
      await prisma.user.delete({ where: { id } });
    },

    async linkAccount(account: AdapterAccount) {
      await upsertOauthAccount(account);
    },

    async unlinkAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      await prisma.oauthAccount.deleteMany({ where: { provider, providerAccountId } });
    },
  };
}

/** Create or refresh the provider link for a user (idempotent). */
export async function upsertOauthAccount(account: AdapterAccount): Promise<void> {
  const tokens = {
    type: account.type,
    refresh_token: account.refresh_token ?? null,
    access_token: account.access_token ?? null,
    expires_at: account.expires_at ?? null,
    token_type: account.token_type ?? null,
    scope: account.scope ?? null,
    id_token: account.id_token ?? null,
    session_state: typeof account.session_state === "string" ? account.session_state : null,
  };
  await prisma.oauthAccount.upsert({
    where: {
      provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId },
    },
    create: {
      userId: account.userId,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      ...tokens,
    },
    update: tokens,
  });
}
