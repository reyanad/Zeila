# Marketplace

All-in-one multi-vendor marketplace combining:

- **Physical e-commerce** — multi-warehouse inventory, SKU variant matrices, wholesale
  MOQ tiers, carrier tracking, RMA returns.
- **Digital assets** — encrypted vault storage, time-limited signed download URLs,
  automated license keys with device activations.
- **Services & gigs** — Basic/Standard/Premium tiers, milestone escrow, intake forms,
  deliverable workspaces and revision loops.

Payments run on Stripe Connect split payments with delayed escrow transfers, backed by
an immutable double-entry ledger.

## Stack

Turborepo · Next.js 15 (App Router) · TypeScript strict · PostgreSQL 16 + Prisma 7 +
pgvector · Meilisearch · Redis + BullMQ · Stripe Connect · Cloudflare R2/S3 · Socket.io ·
Resend · React Native (Expo) companion app.

## Repository layout

```
apps/
  web/              Next.js 15 storefront + vendor studio + admin
packages/
  database/         Prisma schema & client (@marketplace/database)
  shared-types/     Framework-free domain types & money helpers
  ui/               Shared React components
docker-compose.yml  Postgres (pgvector) · Redis · Meilisearch
PROGRESS.md         Phase-by-phase status & setup notes
```

## Getting started

See the **Local setup** section of [PROGRESS.md](./PROGRESS.md).
