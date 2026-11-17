# syntax=docker/dockerfile:1.7
# Worker or realtime gateway (TypeScript run with tsx). Build with:
#   docker build -f docker/node-service.Dockerfile --build-arg APP=@marketplace/worker --build-arg ENTRY=apps/worker/src/index.ts .
FROM node:22-bookworm-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
WORKDIR /app
# Prisma's CLI needs OpenSSL to pick the right engine build.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS prune
ARG APP
COPY . .
RUN npx --yes turbo@2.11.10 prune "$APP" --docker

FROM base AS runner
ARG ENTRY
ENV ENTRY=$ENTRY
COPY --from=prune /app/out/json/ .
RUN npm ci --include=dev && npm cache clean --force
COPY --from=prune /app/out/full/ .
# `turbo prune` copies workspaces only; the shared compiler settings live at the root.
COPY tsconfig.base.json ./
RUN npm run db:generate && groupadd --system app && useradd --system --gid app --home /app app && chown -R app:app /app
ENV NODE_ENV=production
USER app
CMD ["sh", "-c", "exec npx tsx \"$ENTRY\""]
