# Multi-stage build for the Vintrax web app.
#
# Three values are compiled in rather than read at runtime, and all three are
# therefore build arguments:
#
#   NEXT_PUBLIC_API_URL  inlined into the browser bundle by Next
#   NEXT_PUBLIC_WS_URL   likewise
#   NEXT_PUBLIC_BRAND_LOGO_SRC  likewise; optional brand artwork override
#   API_ORIGIN           the rewrite destination in next.config.mjs
#
# The last one is the surprising one. Next resolves rewrites() at build time
# into routes-manifest.json, so setting API_ORIGIN on the running container
# changes nothing about where /api is proxied. It still has to be set at
# runtime as well, because serverFetch() reads it per request for server
# components — the two uses are genuinely different and both are needed.
#
# In a deployment behind Nginx the baked value is never exercised: the proxy
# routes /api and /uploads to the API before Next sees them. It matters for the
# bare compose stack, where Next is the only thing in front of the browser.

FROM node:22-alpine AS base
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
RUN pnpm install --frozen-lockfile --filter @vintrax/frontend...

# ---- Build ------------------------------------------------------------------
FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL
ARG API_ORIGIN=http://api:3001
# Optional: a path under frontend/public to use as the brand lockup instead of
# the drawn one, e.g. /vintrax-logo.png. Empty means use the drawing.
ARG NEXT_PUBLIC_BRAND_LOGO_SRC
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_BRAND_LOGO_SRC=$NEXT_PUBLIC_BRAND_LOGO_SRC
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY . .
RUN pnpm --filter @vintrax/shared build \
 && pnpm --filter @vintrax/frontend build

# ---- Runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The traced server reads these rather than argv; `next start -p` is not what
# runs here, so a port passed as a flag would be ignored. HOSTNAME must be set:
# the default binds loopback, which is unreachable from outside the container.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# PID 1 in a container does not get the kernel's default signal handlers. Both
# runtimes register their own SIGTERM handler — Nest through enableShutdownHooks(),
# Next inside its standalone server — so the process does stop on a signal. The
# compose services additionally set `init: true`, which puts Docker's own init
# at PID 1 to reap orphans; `docker run --init` is the equivalent by hand.

# output: 'standalone' traces the server and only the dependencies it actually
# reaches. Static assets and public/ are deliberately not traced and have to be
# copied alongside it.
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
# public/ is not traced either. It is kept in the repository with a .gitkeep
# even when empty, because this COPY fails on a path that is not there — and it
# is where supplied brand artwork lands (see documentation/brand.md).
#
# Everything in it is served from the site root, so nothing explanatory goes
# in here: a README dropped alongside the artwork would be readable at
# /README.md by anyone who asked.
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "frontend/server.js"]
