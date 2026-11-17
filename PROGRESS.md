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
- [x] **Phase 8 — Messaging, notifications & disputes**: buyer–store threads (`/messages`)
      with "Message the seller" on listings, stores and orders; anti-circumvention screening
      (phone numbers incl. Ethiopian formats, e-mails, Telegram/WhatsApp links and handles are
      hidden; Telebirr/CBE Birr/bank-transfer/"pay outside" talk in English and Amharic is
      flagged with an escrow warning); custom offer cards that become an escrow-protected
      service order on acceptance; Socket.io gateway (`apps/realtime`, Redis fan-out, signed
      one-minute tickets) for live messages, typing and read receipts, with polling when it is
      not configured; in-app notifications (`/notifications`, header badges) for every order,
      payment, delivery, return, refund and case event, e-mailed through Resend by the worker
      (unread-message e-mails throttled to one per 30 minutes, opt-out toggle); resolution
      center (`/disputes`): buyer opens a case with evidence (escrow frozen), seller replies or
      offers a refund the buyer can accept, either side can escalate, deadlines auto-escalate
      or close; staff queue and decisions in `/admin/disputes`; Stripe chargebacks recorded as
      card disputes with evidence submission, and the bank's decision applied to the ledger.
- [x] **Phase 9 — Growth**: flash sales (`/seller/studio/promotions`): a percentage off chosen
      listings for a time window, optionally capped per listing; sale units are claimed with a
      conditional UPDATE when the order is placed and returned if it is never paid; sale prices
      show on cards, the listing page (banner with live countdown), the cart and `/deals`;
      seller coupon codes (percent or amount, minimum order, total and per-buyer limits,
      schedule, on/off); affiliate program (`/affiliates`): `?ref=CODE` links on any page,
      30-day last-click attribution, commission = a share of the platform's fee net of refunds,
      approved by the worker once the order is settled and booked to the ledger; verified
      reviews (buyers of delivered items only, editable for 30 days, contact details screened),
      rating breakdown on listings, seller replies (`/seller/studio/reviews`); seller analytics
      (`/seller/studio/analytics`): sales, orders, average order, conversion, refunds, rating,
      escrow and payout balances, daily sales and views charts with a table view, top listings.
- [x] **Phase 10 — Admin command center** (`/admin`, every section gated by its own
      permission and audited): overview of waiting queues; identity checks with decrypted
      documents shown only to reviewers (every view audited, ID numbers masked, no self-review),
      approve/reject with a note to the seller, store status recalculated; listing moderation
      (pre-publish queue, find and take down live listings); review moderation (hide/restore,
      rating recalculated); resolution center queues (Phase 8); fraud desk (open flags,
      repeated off-platform attempts from chat screening, stores with card disputes); users
      (search, suspend with sign-out everywhere and store suspension, reinstate, role changes
      by super admins only); ledger (trial balance per currency, escrow and payable reconciled
      against order records, platform accounts, affiliate payouts recorded to the ledger,
      chargeback losses to recover, latest journal entries); platform settings (fee, protection
      window, listing review mode, tax table validated against its schema); audit log viewer.
- [x] **Phase 11 — Mobile app** (`apps/mobile`, Expo SDK 58 + Expo Router, iOS and Android):
      browse and search with type filters and live flash prices, listing detail with photos,
      "Buy securely" (escrow checkout in an in-app browser) and "Message the seller"; orders
      with per-store status, tracking links, service workspaces and "I received it" (releases
      escrow after a confirmation); messages with screened chat, custom offer cards and
      polling while open; alerts; account. Sign-in with e-mail, password and two-factor code
      issues a 60-day bearer session (only its SHA-256 is stored; password change, sign-out
      everywhere and suspension end it); the token lives in the device keychain/keystore.
      Push notifications through Expo for every notification and new chat messages, with
      stale tokens removed; tapping a push opens the matching screen.
- [x] **Phase 12 — Tests, hardening, CI/CD**: Vitest unit suite (pricing, promos, shipping,
      tax, ledger balancing, refund splits, settlement, sub-order statuses, flash pricing,
      affiliate commission, licence keys, chat screening, money parsing and FX, realtime
      tickets, chart geometry, field/object/stream encryption and signed tickets, CSP);
      PostgreSQL integration suite covering checkout → payment → escrow → shipping → return →
      release, service delivery → dispute → settlement → referral, approvals, chat screening and
      flash-sale caps, asserting after each step that the ledger balances and matches the order
      records; Playwright smoke tests (desktop and mobile) for pages, redirects, headers and
      APIs; nonce-based Content Security Policy on every page plus HSTS, frame, referrer and
      permissions headers; GitHub Actions CI (types, lint, unit tests, Android bundle,
      integration tests on Postgres + pgvector with a migration drift check, production build,
      E2E); Docker images for web, worker and realtime published to GHCR after green CI;
      production Docker Compose with Caddy (automatic HTTPS).

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

## Messaging, notifications & disputes (Phase 8)

Run the realtime gateway next to the web app and worker:

```bash
npm run dev -w @marketplace/realtime-server   # Socket.io on REALTIME_PORT (4001)
```

It needs the same `AUTH_SECRET` and `REDIS_URL` as the web app; browsers reach it at
`NEXT_PUBLIC_REALTIME_URL` (put it behind TLS in production, e.g. `wss://rt.<domain>`).
Several gateway instances can run behind a load balancer: events travel through Redis.

Case rules: the other side has 3 days to reply (`DISPUTE_RESPONSE_DAYS`). A seller who does
not reply sends the case to staff; a buyer who does not reply closes it. Cases can be opened
only while the seller's payment is still held; staff decisions refund from escrow and release
the rest immediately. A lost chargeback takes the buyer's money back out of escrow; if the
seller was already paid, it is booked to `platform:chargebacks` for recovery (Phase 10 shows
these in the ledger view).

## Growth features (Phase 9)

- Flash sale prices stack on wholesale tiers (the sale percentage applies to the tier price).
  A line above the sale's remaining capped quantity is charged the normal price.
- Affiliates earn `Affiliate.commissionBps` (default 20%) of the platform commission on
  orders placed within 30 days of their link being clicked (last click wins; self-referrals
  ignored). The worker's escrow job approves commissions once every sub-order is settled and
  posts `platform:affiliates` → `affiliate:<id>:payable`. Paying affiliates is done from the
  admin command center (Phase 10).
- Listing views are counted once per browser session (bots skipped) into `ListingViewDaily`.

## Mobile app (Phase 11)

```bash
cd apps/mobile
echo "EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:3000" > .env   # Android emulator: http://10.0.2.2:3000
npx expo start            # scan the QR code with Expo Go, or press a / i for an emulator
```

Store builds use EAS: `npx eas init` (sets the project id; put it in
`EXPO_PUBLIC_EAS_PROJECT_ID`), then `npx eas build --platform all`. Push notifications only
work on real devices with a project id. The API lives under `/api/mobile/*` on the web app
(bearer tokens, JSON); checkout, returns, reviews and disputes open the web pages in an
in-app browser so payments stay on the PCI-compliant Stripe flow.

## Tests (Phase 12)

```bash
npm test                     # unit tests (no database needed)
docker compose up -d postgres
npm run db:deploy -w @marketplace/database   # or db:migrate in development
npm run test:integration     # money flows against PostgreSQL
npm run build -w @marketplace/web && npm run e2e -w @marketplace/web   # Playwright
```

## Deploying (when the domain is ready)

1. A server with Docker (2 vCPU / 4 GB RAM is enough to start), DNS `A` records for the domain,
   `www` and `rt` (realtime) pointing at it.
2. In GitHub: Settings → Variables → `PUBLIC_APP_URL=https://<domain>` and
   `PUBLIC_REALTIME_URL=https://rt.<domain>`; the next green CI run on `main` publishes images to
   `ghcr.io/<owner>/zeila-{web,worker,realtime}` (make the packages public or `docker login ghcr.io`
   on the server).
3. On the server: copy `deploy/`, fill in `deploy/.env.production` from the example, then
   `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d`.
   Migrations run first; Caddy obtains HTTPS certificates.
4. Stripe dashboard: webhooks to `https://<domain>/api/webhooks/stripe` (platform events) and
   `/api/webhooks/stripe-connect` (connected accounts); put the signing secrets in the env file.

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
environment cannot download Prisma's native engines, so database work is verified in GitHub
Actions: the initial migration (`prisma/migrations/20261117000000_init`) was generated there by
Prisma's own engine, and CI applies it to PostgreSQL + pgvector, checks it matches the schema
exactly, and runs the integration and end-to-end suites against it.
Phase 4 also module-loaded the worker under `tsx` (which caught an ESM/CommonJS export
bug that type checking missed) and checked document building and currency conversion.
Phase 5 ran 16 unit checks of the pricing engine (rounding, promo allocation, weight-based
and free shipping, tax on shipping, international blocking). Phase 6 checked ledger
balancing rules, settlement for platform- and store-funded promos (every payment entry
balances), licence key generation, and the download route end to end (encrypted vault →
signed link → decrypted bytes match; expired and forged links refused). Phase 7 checked
the refund split (full refunds unwind escrow, commission and promo exactly; partial refunds
balance and never exceed escrow) and 12 sub-order status transitions. Phase 8 checked the
chat screening (8 cases: Ethiopian and international phone numbers, obfuscated e-mails,
Telegram links, Amharic payment terms; order numbers, dates and prices untouched), realtime
tickets (valid, wrong secret, expired, forged), e-mail HTML escaping, module loading of the
worker, and the gateway (health check; a forged ticket is refused). Phase 9 checked affiliate
commission maths (share of fee, pro-rata refunds, cancelled sub-orders), flash pricing (within
and over the cap, uncapped, none), and the chart geometry (clean ticks, compact axis labels,
24px column cap with air and a 2px gap, baseline-anchored columns), and rendered the sales
chart to an image to check labels and layout. Phase 11 type-checked the app and bundled it
for Android with Metro (1,314 modules, including the shared workspace package). Phase 12 runs
63 unit tests locally; it also started the production build and checked that every script on
the sign-in and registration pages carries the CSP nonce, that the security headers are set,
that private pages redirect to sign-in and that the mobile and licence APIs validate input.
In GitHub Actions the integration suite (checkout, payment, escrow, shipping, partial return,
release, service delivery, dispute settlement, referral approval, chat screening, flash-sale caps,
with the ledger balanced and reconciled after every step) and all 18 end-to-end checks pass.

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
- **Disputes after payout.** Default chosen: buyers can open a case only while the seller's
  payment is held (delivery + `escrow_hold_days`). After that, support handles it manually.
- **First super admin.** Put your address in `SUPER_ADMIN_EMAILS`, sign up with it and verify
  it; the first sign-in promotes it to super admin. Promote moderators from `/admin/users`.
- **Affiliate payouts** are recorded manually in `/admin/ledger` after paying by bank or mobile
  money; automatic payouts need a payout provider that supports the affiliates' countries.

## Conventions

- Money: integer minor units everywhere; currency ISO-4217; fees in basis points.
- Ledger: `JournalEntry` + balanced `LedgerLine`s, append-only, idempotencyKey per
  external event; corrections are new entries, never updates.
- One listing model, three types (`PHYSICAL` | `DIGITAL` | `SERVICE`); type-specific
  tables (`Sku`, `DigitalAsset`, `ServiceTier`) hang off it.
