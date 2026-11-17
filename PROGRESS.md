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
- [x] **Phase 3 — Vendor Studio**: `/seller/studio` with listings table and quick status
  actions; one adaptive builder for all three types, validated by shared Zod schemas
  (`listingInputSchema` + `publishIssues`). Physical: option axes → generated SKU matrix,
  per-warehouse stock, compare-at prices, listing-level wholesale discount tiers
  materialised per SKU. Digital: files streamed into the vault (SHA-256, AES-256-GCM,
  no buffering), signed upload tickets, licence-key and download-limit settings.
  Services: Basic/Standard/Premium packages and a buyer intake-form builder. Photos are
  re-encoded to WebP (EXIF/GPS stripped). Warehouses page, category seed, publish rules
  (store must be active; pre/post moderation via `listing_review_mode` setting).
- [x] **Phase 4 — Storefront & search**: `packages/search` (Meilisearch documents, index
  settings, full and incremental sync, database-search fallback), `packages/jobs` (BullMQ
  queues), `apps/worker` (search sync, OpenAI-compatible embeddings into pgvector, daily FX
  rates). Server-rendered storefront: home, `/search` (filters, sorting, price in the
  visitor's currency), `/c/[slug]` categories, `/listing/[slug]` with gallery, variant
  picker (stock, compare-at, wholesale tiers), service package tabs and digital file
  details, `/store/[slug]`, similar listings (pgvector cosine, category fallback),
  currency switcher with approximate conversions, JSON-LD, sitemap and robots.
- [x] **Phase 5 — Cart & checkout**: `packages/core` with a pure pricing engine (wholesale
  tiers, promo allocation by largest remainder, per-store weight-based shipping from seller
  shipping profiles, destination tax table), guest + account carts (merged at sign-in),
  promo-code validation (dates, currency, usage and per-buyer limits), split orders (one
  sub-order per store with platform fee), race-free stock reservations, 30-minute payment
  hold with a worker sweep that cancels expired orders, Stripe PaymentIntent (separate
  charges and transfers via `transfer_group`) with the Payment Element, payment webhooks
  (late or mismatched payments are refunded automatically), free-order path, cart,
  checkout, payment and order pages, seller shipping-rates page.
- [x] **Phase 6 — Ledger, escrow & digital delivery**: immutable double-entry ledger
  (`postEntry` rejects unbalanced or per-currency mismatched entries; idempotency key per
  business event; chart of accounts for cash, commission, promotions, refunds and per-store
  escrow/payable), posted atomically with payment; one escrow per sub-order; instant
  digital fulfillment (download grants, licence keys from templates) with signed,
  time-limited download links that stream and decrypt from the vault; buyer
  "I received it" releases escrow immediately; worker job every 10 minutes releases escrow
  after the hold period and transfers sellers' share (in the charge's settlement currency)
  to their connected accounts; chargebacks freeze escrow, won chargebacks unfreeze it;
  refund and payout webhooks.
- [x] **Phase 7 — Fulfilment**: seller order desk (`/seller/studio/orders`) with To do /
      Shipped / Returns / Completed tabs; physical orders: mark preparing, ship with carrier
      and tracking link (EMS, DHL, FedEx, UPS, Aramex, local courier), tracking events,
      delivered (starts the protection window), seller cancel with full refund and restock;
      returns portal (buyer requests while escrow is held → escrow frozen → seller approves or
      declines → buyer adds return tracking → seller refunds, optionally restocks); refund
      engine that unwinds the ledger proportionally (store escrow, commission, platform-funded
      promo) and revokes licences; licence activation API (`/api/licenses/activate`,
      `/validate`, `/deactivate`) with per-device limits; service workspace
      (`/orders/[id]/work/[itemId]`) with the buyer's brief (intake answers and files),
      encrypted deliverable uploads, revision rounds within the package allowance, approval
      that pays the seller, and auto-approval when the hold window ends.
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

## Environment variables added in Phase 3

| Variable | Purpose |
| --- | --- |
| `PUBLIC_ASSET_BASE_URL` | Public URL of the public bucket (R2 custom domain). Empty = images served through `/api/assets`. |
| `DIGITAL_UPLOAD_MAX_MB` | Largest digital product upload in MB (default 500). |

After the first migration, load the starter categories: `npm run db:seed`.

## Checkout setup (Phase 5)

- `STRIPE_PUBLISHABLE_KEY` is read on the server and handed to the payment form.
- Subscribe the platform webhook (`/api/webhooks/stripe`) to `payment_intent.succeeded`,
  `payment_intent.payment_failed` and `payment_intent.processing`.
- Sellers set shipping rates under **Studio → Shipping** before publishing physical products.
- Tax rates are a platform setting (`tax_rates`); until an administrator configures them,
  no tax is charged (admin UI arrives in Phase 10).

## Money flow (Phase 6)

Payment → `platform:cash` debited; each store's share (after commission) credited to
`store:<id>:escrow`, commission to `platform:fees`, platform-funded discounts debited to
`platform:promotions`. Release moves escrow → `store:<id>:payable`; the Stripe transfer
settles payable against cash. `trialBalance()` must always return 0 per currency.

Additional webhook events: platform endpoint `charge.dispute.created`,
`charge.dispute.closed`, `charge.refunded`; Connect endpoint `payout.created`,
`payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`.

## Fulfilment (Phase 7)

Sub-order status follows its items: all delivered → `DELIVERED` (the escrow hold window
restarts from that moment), all done → `COMPLETED`, service work in progress →
`IN_PROGRESS`, physical items handed over → `SHIPPED`. The worker's `release-escrow` job
pays out delivered sub-orders whose window ended with no open return or dispute.

Refunds come out of escrow, so they are possible only while it is held or frozen; after
release, recovery goes through disputes (Phase 8). A refund of `R` from a sub-order the
buyer paid `P` for debits the store's escrow and the platform's commission and credits any
platform-funded promotion in proportion, so a full refund exactly reverses the payment
entry. Stripe refunds use idempotency keys per business event (`refund-rma:<id>`,
`refund-seller-cancel:<subOrderId>`).

Licence API for software vendors (JSON, 60 requests per minute per IP):

```bash
curl -X POST https://<domain>/api/licenses/activate \
  -H 'Content-Type: application/json' \
  -d '{"key":"ABCD-EFGH-JKLM-NPQR","fingerprint":"<stable device id>","deviceName":"Office PC"}'
# 200 {"ok":true,"status":"ACTIVE","activationsUsed":1,"activationsLimit":3,...}
# 404 NOT_FOUND · 403 REVOKED / EXPIRED / NOT_ACTIVATED · 409 LIMIT_REACHED · 429 RATE_LIMITED
```

`/api/licenses/validate` and `/api/licenses/deactivate` take `{ key, fingerprint }`.
Re-activating a device that is already active does not use another slot; a refund revokes
the key.

Files attached to orders (deliverables, intake uploads) are encrypted in the vault under
`attachments/<orderItemId>/`, up to 200 MB each, and only the buyer and seller of that item
can download them.

## Running the worker (Phase 4)

```bash
npm run dev -w @marketplace/worker        # search sync, embeddings, daily FX rates
npm run reindex -w @marketplace/worker    # one-off full rebuild of the search index
```

Without `MEILI_HOST` the storefront searches PostgreSQL directly; without embeddings
settings, "similar listings" uses the same category. Once the catalogue grows past a few
thousand listings, add an approximate-nearest-neighbour index in a custom migration
(`npx prisma migrate dev --create-only`, then add):

```sql
CREATE INDEX listing_embedding_hnsw ON "Listing" USING hnsw ("embedding" vector_cosine_ops);
```

## Verification status

Each phase is verified with `prisma validate`, `tsc --noEmit` in every workspace and
`next build`. Phase 3 also ran runtime checks of the listing schemas and an encrypted
stream round-trip (5 MB upload → vault → ranged decrypt; tampering rejected). The build
environment cannot download Prisma's native engines, so nothing has yet run against a
live PostgreSQL database; Phase 12 adds CI integration tests against Postgres + pgvector.
Phase 4 also module-loaded the worker under `tsx` (which caught an ESM/CommonJS export
bug that type checking missed) and checked document building and currency conversion.
Phase 5 ran 16 unit checks of the pricing engine (rounding, promo allocation, weight-based
and free shipping, tax on shipping, international blocking). Phase 6 checked ledger
balancing rules, settlement for platform- and store-funded promos (every payment entry
balances), licence key generation, and the download route end to end (encrypted vault →
signed link → decrypted bytes match; expired and forged links refused). Phase 7 checked
the refund split (full refunds unwind escrow, commission and promo exactly; partial refunds
balance and never exceed escrow) and 12 sub-order status transitions.

## Needs owner input

- **Payments for Ethiopian sellers and buyers.** Sellers are onboarded with Stripe Connect
  Express using *separate charges and transfers* (the flow escrow needs anyway). Stripe can pay
  out to sellers in countries such as Ethiopia only through cross-border payouts, which require
  the platform's Stripe account to be US-based (`STRIPE_PLATFORM_COUNTRY=US`). Buyers paying with
  Telebirr / CBE Birr / Chapa would need a second payment provider. Decide: (a) register the
  platform entity in the US and use Stripe for card payments, (b) add a Chapa adapter for
  local ETB payments alongside Stripe, or (c) both. Default chosen: (a), Stripe only.
- **Tax.** Configure the `tax_rates` table per destination country (for Ethiopia, the VAT
  rate and whether it applies to services and shipping), and decide who remits it. Default
  chosen: prices are tax-exclusive, tax is added at checkout and passed to the seller.
- **Promo funding.** Default chosen: store codes are paid for by the store (the platform fee
  is charged on the discounted amount); platform-wide codes are paid for by the platform
  (sellers are paid as if no discount applied).
- **Return window.** Default chosen: the escrow hold period (`escrow_hold_days`, 3 days after
  delivery). Many marketplaces use 7–14 days for physical goods; a longer window delays seller
  payouts by the same amount.
- **KYC review** happens in the admin command center (Phase 10). Until then, submissions stay
  `PENDING` and stores stay in `PENDING_REVIEW`.

## Conventions

- Money: integer minor units everywhere; currency ISO-4217; fees in basis points.
- Ledger: `JournalEntry` + balanced `LedgerLine`s, append-only, idempotencyKey per
  external event; corrections are new entries, never updates.
- One listing model, three types (`PHYSICAL` | `DIGITAL` | `SERVICE`); type-specific
  tables (`Sku`, `DigitalAsset`, `ServiceTier`) hang off it.
