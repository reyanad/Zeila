import "dotenv/config";
import { z } from "zod";

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required for the worker"),
  MEILI_HOST: optional,
  MEILI_MASTER_KEY: optional,
  EMBEDDINGS_API_URL: optional,
  EMBEDDINGS_API_KEY: optional,
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  STRIPE_SECRET_KEY: optional,
  FX_RATES_URL: z.string().url().default("https://open.er-api.com/v6/latest/USD"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("Marketplace <no-reply@example.com>"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("Zeila"),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(): WorkerEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid worker environment: ${problems}`);
  }
  return parsed.data;
}
