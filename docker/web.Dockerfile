# syntax=docker/dockerfile:1.7
# Next.js web app (storefront, studio, admin, APIs) as a standalone server.
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
WORKDIR /app
# Prisma's CLI needs OpenSSL to pick the right engine build.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.10 prune @marketplace/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN npm ci
COPY --from=prune /app/out/full/ .
# `turbo prune` copies workspaces only; the shared compiler settings live at the root.
COPY tsconfig.base.json ./
# Public values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_REALTIME_URL=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL
RUN npm run db:generate && npx turbo run build --filter=@marketplace/web

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --home /app app && mkdir -p /app/.data && chown app:app /app/.data
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
