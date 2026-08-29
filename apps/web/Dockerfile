# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# apps/web production image — Next.js standalone output, multi-stage, non-root.
#
# BUILD CONTEXT MUST BE THE MONOREPO ROOT, not apps/web/, because this is an
# npm workspaces project: package-lock.json, node_modules hoisting, and the
# @mafia/shared -> @mafia/web dependency all live at the root. Build from the
# repo root:
#
#   docker build -f apps/web/Dockerfile -t mafia-web .
#
# Three stages, mirroring apps/server/Dockerfile:
#   deps    — installs the full workspace's node_modules ONCE, devDependencies
#             included, since `next build` needs them.
#   build   — compiles @mafia/shared (next transpilePackages reads its dist),
#             then runs `next build`. output:'standalone' in next.config.mjs
#             emits .next/standalone with a trimmed server + node_modules.
#   runtime — a slim base with ONLY the standalone bundle + static assets.
#
# API_ORIGIN is a BUILD-TIME arg: next.config.mjs bakes it into the rewrites
# that proxy /api and /socket.io to the Render backend so the session cookie
# stays first-party. render.yaml passes it through from the dashboard value.
# -----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /repo
ARG API_ORIGIN
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
# @mafia/shared ships raw TS; build its dist first (matches root `npm run
# build` ordering) so next's transpilePackages resolves it.
RUN npm run build -w packages/shared
RUN npm run build -w apps/web

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# In a workspaces repo, `next build` with output:'standalone' emits the
# bundle preserving the monorepo layout: .next/standalone/apps/web/server.js
# plus a hoisted .next/standalone/node_modules. COPY the whole standalone
# tree to /repo so those relative paths resolve, then drop static/ and
# public/ where server.js expects them (next.config.mjs sets no basePath).
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Reuse the base image's built-in `node` user (uid/gid 1000) rather than
# inventing one, matching apps/server/Dockerfile.
RUN chown -R node:node /repo
USER node

EXPOSE 3000

# standalone emits server.js at the workspace-relative path apps/web/server.js
# inside the bundle root we COPYed to /repo/apps/web.
CMD ["node", "apps/web/server.js"]
