# Build Progress

Production marketplace: physical e-commerce + digital assets + services/gigs,
split orders, Stripe Connect escrow, double-entry ledger.

## Phases

- [x] **Phase 1 — Foundation**: Turborepo monorepo (`apps/web`, `packages/database`,
  `packages/shared-types`, `packages/ui`), `docker-compose.yml` (Postgres 16 + pgvector,
  Redis 7, Meilisearch v1.12), `.env.example`, complete Prisma 7 `schema.prisma` (Rust-free client + pg driver adapter; connection URL lives in `prisma.config.ts`)
  (users/auth/KYC, stores/warehouses/inventory, polymorphic listings with SKU matrices +
  wholesale MOQ tiers, digital vault assets + license keys/activations, service tiers +
  intake forms, unified cart, split orders, payments/refunds, escrow + milestones +
  revisions + deliverables, shipments + RMA, immutable double-entry ledger, payouts,
  disputes, messaging, reviews, affiliates, promo codes, fraud flags, audit log,
  platform settings). `apps/mobile` is scaffolded in Phase 11 per roadmap.
- [x] **Phase 2 — Identity & seller onboarding**: Auth.js (next-auth v4) with JWT sessions,
  credentials + Google/GitHub OAuth, e-mail confirmation, password reset, TOTP 2FA with
  recovery codes, session revocation (`User.sessionVersion`), RBAC permission matrix
  (`BUYER`/`SELLER`/`MODERATOR`/`SUPER_ADMIN`) enforced in middleware, pages and actions;
  seller onboarding at `/seller/onboarding` (open store → KYC with encrypted vault uploads →
  Stripe Connect Express payouts); idempotent Stripe webhook inbox (`WebhookEvent`) at
  `/api/webhooks/stripe` and `/api/webhooks/stripe-connect`; store status derived from
  KYC + payout readiness (`DRAFT` → `PENDING_REVIEW` → `ACTIVE`).
- [ ] Phase 3 — Vendor Studio & polymorphic listing builder (adaptive Zod schemas)
- [ ] Phase 4 — Meilisearch sync workers, pgvector recommendations, SSR storefront
- [ ] Phase 5 — Unified multi-type cart, tax/shipping engine, promo codes, Stripe split checkout
- [ ] Phase 6 — Idempotent webhooks, ledger engine, digital fulfillment, BullMQ escrow cron
- [ ] Phase 7 — Fulfillment: carrier tracking/RMA, encrypted vault + license API, milestone workspace
- [ ] Phase 8 — Socket.io messaging, notifications, dispute resolution center
- [ ] Phase 9 — Flash sales, affiliates, verified reviews, seller analytics
- [ ] Phase 10 — Super-admin command center
- [ ] Phase 11 — Expo mobile app
- [ ] Phase 12 — Tests, hardening, CI/CD

## Local setup (after Phase 1)

```bash
cp .env.example .env          # fill values; defaults work for docker dev
docker compose up -d          # postgres (pgvector), redis, meilisearch
npm install
npm run db:generate           # prisma client
npm run db:migrate            # first migration (named: init)
npm run dev                   # turbo dev (web on :3000)
```

## Environment variables added in Phase 1

See `.env.example` — database/redis/meilisearch connection settings, and
placeholders (used from Phase 2 on) for Auth.js, Stripe Connect, R2/S3 and Resend.

## Environment variables added in Phase 2

| Variable | Purpose |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM key material for TOTP secrets, ID numbers and vault files. Required in production; never rotate without re-encrypting data. |
| `SUPER_ADMIN_EMAILS` | Comma-separated addresses promoted to `SUPER_ADMIN` after e-mail confirmation. |
| `STRIPE_PLATFORM_COUNTRY` | Country of the platform Stripe account (default `US`). Sellers elsewhere get cross-border `recipient` accounts. |
| `LOCAL_STORAGE_DIR` | Dev-only file storage when S3/R2 credentials are empty (git-ignored). |

Stripe webhooks (local development):

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe            # platform events
stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe-connect  # connected accounts
```

Put each printed `whsec_...` secret in `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET`.
Subscribe the Connect endpoint to `account.updated`, `capability.updated` and
`account.application.deauthorized`.

## Needs owner input

- **Payments for Ethiopian sellers and buyers.** Sellers are onboarded with Stripe Connect
  Express using *separate charges and transfers* (the flow escrow needs anyway). Stripe can pay
  out to sellers in countries such as Ethiopia only through cross-border payouts, which require
  the platform's Stripe account to be US-based (`STRIPE_PLATFORM_COUNTRY=US`). Buyers paying with
  Telebirr / CBE Birr / Chapa would need a second payment provider. Decide: (a) register the
  platform entity in the US and use Stripe for card payments, (b) add a Chapa adapter for
  local ETB payments alongside Stripe, or (c) both. Default chosen: (a), Stripe only.
- **KYC review** happens in the admin command center (Phase 10). Until then, submissions stay
  `PENDING` and stores stay in `PENDING_REVIEW`.

## Conventions

- Money: integer minor units everywhere; currency ISO-4217; fees in basis points.
- Ledger: `JournalEntry` + balanced `LedgerLine`s, append-only, idempotencyKey per
  external event; corrections are new entries, never updates.
- One listing model, three types (`PHYSICAL` | `DIGITAL` | `SERVICE`); type-specific
  tables (`Sku`, `DigitalAsset`, `ServiceTier`) hang off it.
