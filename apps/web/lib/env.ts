import "server-only";
import { z } from "zod";

/**
 * Server environment, validated lazily on first use so `next build` and
 * `tsc` never need real secrets. Optional integrations (OAuth, Stripe, Resend,
 * S3/R2, Redis) report themselves as "not configured" instead of crashing.
 */

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
  DATA_ENCRYPTION_KEY: optionalString,
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  SUPER_ADMIN_EMAILS: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,

  REDIS_URL: optionalString,

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default("Marketplace <no-reply@example.com>"),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalString,

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET_PUBLIC: z.string().default("marketplace-public"),
  S3_BUCKET_VAULT: z.string().default("marketplace-vault"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
});

export type Env = z.infer<typeof envSchema>;

/** Values shipped in `.env.example`; they must never be accepted as real secrets. */
const EXAMPLE_VALUES: ReadonlySet<string> = new Set([
  "generate_with_openssl_rand_base64_32",
  "sk_test_xxx",
  "pk_test_xxx",
  "whsec_xxx",
  "re_xxx",
]);

function isExample(value: string | undefined): boolean {
  return value !== undefined && EXAMPLE_VALUES.has(value);
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (isExample(env.AUTH_SECRET)) {
      throw new Error("AUTH_SECRET still has the .env.example value; generate a real secret before running in production.");
    }
    if (!env.DATA_ENCRYPTION_KEY) {
      throw new Error("DATA_ENCRYPTION_KEY is required in production (openssl rand -base64 32).");
    }
  }
  cached = env;
  return env;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function appUrl(path = "/"): string {
  return new URL(path, getEnv().NEXT_PUBLIC_APP_URL).toString();
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function googleOAuth(): OAuthCredentials | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = getEnv();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function githubOAuth(): OAuthCredentials | null {
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } = getEnv();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function stripeSecretKey(): string | null {
  const key = getEnv().STRIPE_SECRET_KEY;
  return key && !isExample(key) ? key : null;
}

export function stripeWebhookSecret(kind: "platform" | "connect"): string | null {
  const env = getEnv();
  const secret = kind === "platform" ? env.STRIPE_WEBHOOK_SECRET : env.STRIPE_CONNECT_WEBHOOK_SECRET;
  return secret && !isExample(secret) ? secret : null;
}

export function resendApiKey(): string | null {
  const key = getEnv().RESEND_API_KEY;
  return key && !isExample(key) ? key : null;
}

export interface S3Settings {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3Settings(): S3Settings | null {
  const env = getEnv();
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  const endpoint = env.S3_ENDPOINT && !env.S3_ENDPOINT.includes("<account_id>") ? env.S3_ENDPOINT : undefined;
  return {
    endpoint,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

/** Lower-cased e-mail addresses promoted to SUPER_ADMIN once verified. */
export function superAdminEmails(): ReadonlySet<string> {
  const raw = getEnv().SUPER_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}
