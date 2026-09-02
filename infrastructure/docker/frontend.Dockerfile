# Multi-stage build for the Atlas web app.
#
# NEXT_PUBLIC_* values are compiled into the client bundle, so they are build
# arguments rather than runtime environment variables.

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
RUN pnpm install --frozen-lockfile --filter @atlas/frontend...

# ---- Build ------------------------------------------------------------------
FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY . .
RUN pnpm --filter @atlas/frontend build

# ---- Runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/client ./packages/client
COPY --from=build /app/frontend ./frontend

USER node
WORKDIR /app/frontend
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/next", "start", "-p", "3000"]
