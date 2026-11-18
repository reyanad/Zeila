import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@marketplace/database";
import type { UserRoleValue } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { getEnv, githubOAuth, googleOAuth, superAdminEmails } from "@/lib/env";
import { createAuthAdapter, upsertOauthAccount } from "./adapter";
import { completeTicketLogin, issueLoginTicket, TicketLoginError } from "./login";
import { githubEmailIsVerified } from "./github-email";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface SessionClaims {
  id: string;
  role: UserRoleValue;
  sessionVersion: number;
}

/**
 * Load the claims that go into the JWT. Also applies the SUPER_ADMIN
 * bootstrap: a verified address listed in SUPER_ADMIN_EMAILS is promoted the
 * first time it signs in, which is how the first administrator is created.
 */
async function loadSessionClaims(userId: string): Promise<SessionClaims | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, role: true, sessionVersion: true, isSuspended: true },
  });
  if (!user || user.isSuspended) return null;

  if (user.role !== "SUPER_ADMIN" && user.emailVerified && superAdminEmails().has(user.email.toLowerCase())) {
    await prisma.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" } });
    await recordAudit({
      actorId: user.id,
      action: "auth.role.bootstrap",
      entity: "User",
      entityId: user.id,
      data: { from: user.role, to: "SUPER_ADMIN" },
    });
    return { id: user.id, role: "SUPER_ADMIN", sessionVersion: user.sessionVersion };
  }
  return { id: user.id, role: user.role, sessionVersion: user.sessionVersion };
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = headers?.[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function buildProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      id: "credentials",
      name: "Email and password",
      credentials: {
        ticket: { label: "Login ticket", type: "text" },
        code: { label: "Two-factor code", type: "text" },
      },
      async authorize(credentials, request) {
        const ticket = credentials?.ticket;
        if (!ticket) return null;
        const forwarded = headerValue(request.headers, "x-forwarded-for");
        const ip = forwarded?.split(",")[0]?.trim() || headerValue(request.headers, "x-real-ip") || "unknown";
        try {
          return await completeTicketLogin(ticket, credentials?.code || undefined, ip);
        } catch (error) {
          // The message becomes `result.error` on the client; only expose known reasons.
          if (error instanceof TicketLoginError) throw new Error(error.reason);
          console.error("[auth] credentials sign-in failed unexpectedly", error);
          throw new Error("unknown");
        }
      },
    }),
  ];

  // Linking by e-mail is safe here because the signIn callback only admits
  // provider-verified addresses and neutralises unverified pre-registrations.
  const google = googleOAuth();
  if (google) {
    providers.push(GoogleProvider({ ...google, allowDangerousEmailAccountLinking: true }));
  }
  const github = githubOAuth();
  if (github) {
    providers.push(GitHubProvider({ ...github, allowDangerousEmailAccountLinking: true }));
  }
  return providers;
}

let cachedOptions: NextAuthOptions | undefined;

export function getAuthOptions(): NextAuthOptions {
  if (cachedOptions) return cachedOptions;
  const env = getEnv();

  cachedOptions = {
    secret: env.AUTH_SECRET,
    adapter: createAuthAdapter(),
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 24 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    providers: buildProviders(),

    callbacks: {
      async signIn({ user, account, profile }) {
        // Credentials: every check already ran in completeTicketLogin.
        if (!account || account.type === "credentials") return true;

        const email = user.email?.toLowerCase();
        if (!email) return "/login?error=OAuthEmailMissing";
        if (account.provider === "google" && (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
          return "/login?error=OAuthEmailUnverified";
        }
        if (account.provider === "github" && !(await githubEmailIsVerified(account.access_token, email))) {
          return "/login?error=OAuthEmailUnverified";
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (!existing) return true; // first sign-in: the adapter creates the user

        if (existing.isSuspended) return "/login?error=AccountSuspended";

        if (!existing.emailVerified) {
          // Someone registered this address with a password but never proved
          // they own it. The provider just did, so the address belongs to this
          // person: drop the unproven password and any sessions made with it.
          await prisma.user.update({
            where: { id: existing.id },
            data: { emailVerified: new Date(), hashedPassword: null, sessionVersion: { increment: 1 } },
          });
          await recordAudit({
            actorId: existing.id,
            action: "auth.oauth.claimed-unverified",
            entity: "User",
            entityId: existing.id,
            data: { provider: account.provider },
          });
          return true;
        }

        if (existing.twoFactorEnabled) {
          // The provider proved the first factor; finish with the second one.
          await upsertOauthAccount({ ...account, userId: existing.id });
          const ticket = issueLoginTicket(existing, "oauth");
          return `/login/two-factor?ticket=${encodeURIComponent(ticket)}`;
        }
        return true;
      },

      async jwt({ token, user, trigger }) {
        if (user?.id) {
          const claims = await loadSessionClaims(user.id);
          if (claims) {
            token.uid = claims.id;
            token.role = claims.role;
            token.sv = claims.sessionVersion;
          }
        } else if (trigger === "update" && token.uid) {
          // Client asked for a refresh (e.g. after becoming a seller). Only the
          // role is re-read; the session version is deliberately left alone so
          // a revoked session cannot refresh itself back to life.
          const claims = await loadSessionClaims(token.uid);
          if (claims) token.role = claims.role;
        }
        return token;
      },

      async session({ session, token }) {
        session.user.id = token.uid ?? "";
        session.user.role = token.role ?? "BUYER";
        session.sessionVersion = token.sv ?? -1;
        return session;
      },
    },

    events: {
      async signIn({ user, account }) {
        if (!user.id) return;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
        await recordAudit({
          actorId: user.id,
          action: "auth.login",
          entity: "User",
          entityId: user.id,
          data: { provider: account?.provider ?? "unknown" },
        });
      },
      async linkAccount({ user, account }) {
        await recordAudit({
          actorId: user.id,
          action: "auth.oauth.link",
          entity: "User",
          entityId: user.id,
          data: { provider: account.provider },
        });
      },
    },
  };
  return cachedOptions;
}

/** Which OAuth buttons the sign-in page should render. */
export function enabledOAuthProviders(): Array<{ id: "google" | "github"; label: string }> {
  const providers: Array<{ id: "google" | "github"; label: string }> = [];
  if (googleOAuth()) providers.push({ id: "google", label: "Google" });
  if (githubOAuth()) providers.push({ id: "github", label: "GitHub" });
  return providers;
}
