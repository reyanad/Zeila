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
- [ ] Phase 2 — Auth.js (credentials + OAuth + 2FA), RBAC, KYC submission, Stripe Connect onboarding + webhooks
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

## Conventions

- Money: integer minor units everywhere; currency ISO-4217; fees in basis points.
- Ledger: `JournalEntry` + balanced `LedgerLine`s, append-only, idempotencyKey per
  external event; corrections are new entries, never updates.
- One listing model, three types (`PHYSICAL` | `DIGITAL` | `SERVICE`); type-specific
  tables (`Sku`, `DigitalAsset`, `ServiceTier`) hang off it.
