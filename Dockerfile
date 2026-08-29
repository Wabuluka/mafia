# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# Combined production image — runs BOTH apps in one container:
#
#   - apps/server (Express + Socket.IO) on a fixed INTERNAL port (4000),
#     not exposed outside the container.
#   - apps/web (Next.js, standalone output) on $PORT — the port Render
#     injects and routes public traffic to.
#
# apps/web/next.config.mjs rewrites /api/* and /socket.io/* to API_ORIGIN,
# which is baked at build time to http://127.0.0.1:4000 so the browser only
# ever talks to the one public origin (Next), keeping the session cookie
# first-party. See docker-entrypoint.sh for process supervision.
#
# BUILD CONTEXT MUST BE THE MONOREPO ROOT (npm workspaces):
#   docker build -t mafia .
#
# Stages:
#   deps    — full workspace install (devDependencies included: both builds
#             need tsc / the Next toolchain).
#   build   — compile @mafia/shared, then apps/server (tsc) and apps/web
#             (next build --> .next/standalone).
#   runtime — slim base with: the web standalone bundle, the server dist +
#             a production-only node_modules for it, and the entrypoint.
# -----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into apps/web's rewrites: the co-located server, loopback only.
ENV API_ORIGIN=http://127.0.0.1:4000
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/shared packages/shared
# @mafia/shared ships raw TS; build its dist first (matches root `npm run
# build` ordering) — apps/server's tsc build require()s it, apps/web's
# transpilePackages reads it.
RUN npm run build -w packages/shared
RUN npm run build -w apps/server
RUN npm run build -w apps/web

# --- production node_modules for the server (no devDeps) -----------------
FROM node:20-alpine AS server-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
# apps/web's package.json is deliberately NOT copied so npm skips installing
# its deps here (see apps/server/Dockerfile for the same trick).
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Fixed internal port for the server; Render sets PORT for the public web.
ENV SERVER_PORT=4000
ENV HOSTNAME=0.0.0.0

# -- server: compiled dist for both packages + prod-only node_modules -----
COPY --from=server-deps /repo/node_modules ./node_modules
COPY --from=server-deps /repo/package.json ./package.json
COPY --from=build /repo/apps/server/package.json apps/server/package.json
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/server/dist apps/server/dist

# -- web: Next standalone bundle (its own minimal node_modules) -----------
# standalone preserves the workspace layout: apps/web/server.js + a hoisted
# node_modules, both under .next/standalone. Nest it under apps/web-standalone
# so it can't clash with the server's root-level node_modules above.
COPY --from=build /repo/apps/web/.next/standalone apps/web-standalone/
COPY --from=build /repo/apps/web/.next/static apps/web-standalone/apps/web/.next/static
COPY --from=build /repo/apps/web/public apps/web-standalone/apps/web/public

COPY docker-entrypoint.sh /repo/docker-entrypoint.sh
RUN chmod +x /repo/docker-entrypoint.sh && chown -R node:node /repo
USER node

# The public port Render provides; documented for `docker run` locally.
EXPOSE 3000

ENTRYPOINT ["/repo/docker-entrypoint.sh"]
