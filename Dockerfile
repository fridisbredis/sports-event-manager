# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars must be available at build time — they get inlined
# into the client JS bundle by Next.js
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT

# Sentry source-map upload happens during the build step below. SENTRY_AUTH_TOKEN
# is a build-only ARG here (never an ENV in this file), so it is not persisted
# into any image layer's environment — the builder stage that sees it is
# discarded and never pushed. It only needs the `project:releases` scope.
#
# SENTRY_ORG and SENTRY_PROJECT are also read at runtime by SYS-03's health
# dashboard, via the same separate `az containerapp update --set-env-vars`
# channel SUPABASE_SERVICE_ROLE_KEY already uses — Container Apps injects
# them into the process environment directly, never through the image. That
# runtime read uses its own token, SENTRY_API_TOKEN, deliberately a different
# GitHub secret from the build-time SENTRY_AUTH_TOKEN above: the health
# dashboard's GET /issues/ call needs `project:read` (+ `org:read`), which a
# release-upload token doesn't carry — sharing one token for both purposes
# was tried during SYS-03 review and got a 403 from Sentry's API.
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN

# next.config.ts sets output: 'standalone'
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# This HEALTHCHECK only applies to local `docker run` — Azure Container
# Apps does NOT read this instruction. Production probes are configured
# separately (scripts/ops/set-probes.sh, added in a later PERF-05 pass).
# Points at the DB-free liveness endpoint, not /api/health, so a local
# Supabase blip doesn't restart the local container either.
# --start-period gives Next.js time to boot before failures count (see the
# minReplicas/probe-retry lesson in .claude/CLAUDE.md's Lessons Learned).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "server.js"]
