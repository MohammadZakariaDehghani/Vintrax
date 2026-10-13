# Multi-stage build for Vintrax Mobile.
#
# Same shape as the web image, and the same rule applies: NEXT_PUBLIC_* values
# and the rewrite destination are compiled in, so they are build arguments
# rather than runtime environment variables. See frontend.Dockerfile for why
# API_ORIGIN is both — Next bakes rewrites at build time, and nothing on the
# running container can move them.
#
# This image does copy public/, which the web image has no equivalent of: the
# manifest, the icons and the service worker are static files the PWA install
# prompt will not appear without.

# node:22-alpine, the Docker official image, pulled through Google's Docker Hub
# mirror. Anonymous pulls from shared CI runners exhaust Docker Hub's rate limit
# and ECR Public's data limit; the mirror serves the same image. NODE_IMAGE
# overrides it in one place (--build-arg NODE_IMAGE=...) if this registry
# becomes the problem instead.
ARG NODE_IMAGE=mirror.gcr.io/library/node:22-alpine
FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies -----------------------------------------------------------
FROM base AS deps
# Every workspace manifest is copied, not just this app's: the lockfile
# describes the whole workspace, and --frozen-lockfile fails on a missing one.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/client/package.json ./packages/client/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY mobile/package.json ./mobile/
RUN pnpm install --frozen-lockfile --filter @vintrax/mobile...

# ---- Build ------------------------------------------------------------------
FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL
ARG API_ORIGIN=http://api:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=deps /app/mobile/node_modules ./mobile/node_modules
COPY . .
RUN pnpm --filter @vintrax/shared build \
 && pnpm --filter @vintrax/mobile build

# ---- Runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# PID 1 in a container does not get the kernel's default signal handlers. Next's
# standalone server registers its own SIGTERM handler, so the process does stop
# on a signal. The compose services additionally set `init: true`, which puts
# Docker's own init at PID 1 to reap orphans.

COPY --from=build --chown=node:node /app/mobile/.next/standalone ./
COPY --from=build --chown=node:node /app/mobile/.next/static ./mobile/.next/static
COPY --from=build --chown=node:node /app/mobile/public ./mobile/public

USER node
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "mobile/server.js"]
