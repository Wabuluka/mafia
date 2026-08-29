# Deployment

This monorepo ships two deployables — `apps/web` (Next.js) and `apps/server`
(Express + Socket.IO) — plus MongoDB. They deploy to different platforms
because the server needs a **persistent, long-lived WebSocket connection**,
which serverless/edge platforms (including Vercel's own Node runtime) don't
support: a serverless function is torn down between requests, which would
silently drop every socket.

| Component  | Platform                              | Why                                                        |
| ---------- | -------------------------------------- | ------------------------------------------------------------ |
| `apps/web` | Vercel                                 | Static + SSR Next.js hosting; no long-lived connections needed |
| `apps/server` | Railway, Fly.io, or Render (any platform with a persistent process/container) | Needs a long-running process holding open Socket.IO connections |
| MongoDB    | MongoDB Atlas                          | Managed, no ops burden; free tier is enough for this app's data volume |

---

## 1. Server: Dockerfile

`apps/server/Dockerfile` is a 3-stage build (`deps` → `build` → `runtime`).
Build from the **monorepo root**, not `apps/server/`, because this is an npm
workspaces project — the lockfile and the `@mafia/shared` → `@mafia/server`
dependency both live at the root:

```bash
docker build -f apps/server/Dockerfile -t mafia-server .
docker run -p 4000:4000 --env-file apps/server/.env mafia-server
```

Properties:

- **Non-root**: the final stage runs as the `node` user (uid/gid 1000,
  already present in the `node:20-alpine` base image), not root.
- **Slim final image**: the `runtime` stage installs only production
  dependencies (`npm ci --omit=dev`) and copies in just the compiled
  `dist/` output from `build` — no TypeScript compiler, no dev
  dependencies, no `.ts` source ships in the final image. (~260MB as of
  this writing, dominated by the `mongodb` driver and Node itself.)
- **Signal handling**: `CMD` invokes `node apps/server/dist/index.js`
  directly, not `npm start` — npm as PID 1 does not forward `SIGTERM` to
  its child process, which would silently break graceful shutdown (§4)
  under `docker stop` / most orchestrators' shutdown signal.
- **`@mafia/shared` gotcha**: this package ships raw TypeScript in dev
  (consumed via Next's `transpilePackages` and `tsx` directly) but the
  server's own production build (`tsc`, CommonJS) needs a real,
  `require()`-able `dist/`. `packages/shared/tsconfig.build.json` and its
  `build` script exist solely for this — see that file's own comment
  before touching it. The root `npm run build` script builds
  `packages/shared` first, explicitly, before the `-ws` fan-out, since npm
  workspace build ordering is otherwise unspecified.

## 2. Web: Vercel

Deploy `apps/web` as a normal Next.js project on Vercel (root directory:
`apps/web`; Vercel auto-detects the framework). No special configuration
needed beyond the environment variables in §3 — Vercel's build already runs
`next build`, and this repo's `transpilePackages: ['@mafia/shared']` (see
`apps/web/next.config.mjs`) means Vercel's build compiles `@mafia/shared`
from source itself; you do **not** need `packages/shared`'s separate
`dist/` build for the Vercel deploy (that's a server-only concern, §1).

If deploying from a monorepo, either:
- point Vercel's "Root Directory" at `apps/web` and let it install from
  the repo root (Vercel handles npm workspaces natively), or
- use a separate Vercel project per app if you also want to deploy
  `apps/server` there for preview purposes (not recommended for
  production — see the intro's WebSocket caveat).

## 3. Server: Railway / Fly.io / Render

All three work the same way here: point them at `apps/server/Dockerfile`
with the monorepo root as build context, expose the port from `PORT`
(§5's env var), and set the environment variables in §5.

- **Railway**: "Deploy from GitHub repo", set the Dockerfile path to
  `apps/server/Dockerfile` and the build context to the repo root in the
  service's build settings.
- **Fly.io**: `fly launch` from the repo root with a `fly.toml` pointing
  `[build] dockerfile = "apps/server/Dockerfile"`; `fly deploy`.
- **Render**: a "Web Service" backed by the same Dockerfile + root
  context; Render auto-detects the `EXPOSE 4000` and routes to it.

All three provide a WebSocket-capable reverse proxy in front of your
container/process — no extra configuration needed on that front, unlike a
typical serverless platform.

## 4. Graceful shutdown

On `SIGTERM` (sent by every platform above during a deploy/restart) or
local `SIGINT` (Ctrl+C), `apps/server/src/index.ts` runs, in strict order:

1. **Stop accepting new connections** — `httpServer.close()`. Bounds how
   long shutdown can take, and stops a player joining mid-drain just to be
   immediately kicked back off.
2. **Notify players in active games** — `notifyActiveGames` (see
   `realtime/shutdown.ts`) emits a `serverShuttingDown` event to every
   socket in a game that has actually started (not lobby-only sessions,
   which have nothing "active" to warn about). The web client shows a
   full-screen "server restarting" notice (`ServerShuttingDownOverlay.tsx`)
   with a reload button — see that component's header for why reload,
   not auto-retry, is the right response.
3. **Persist state** — `abandonAllActiveGames` (see `realtime/restart.ts`)
   marks every in-memory game session `ABANDONED` in MongoDB, so the next
   boot's crash-recovery pass (`recoverInProgressGames`) never has to guess
   whether a still-`IN_PROGRESS` game document means "running on another
   instance" or "died here" — a clean shutdown always leaves an
   unambiguous record.
4. **Close the DB pool** — `closeDb()`.
5. **Exit** (`process.exit(0)`).

No extra deployment configuration is required for this to work — just make
sure your platform's shutdown grace period (Railway/Fly/Render all default
to somewhere around 10–30s) is long enough for step 2's notification to
reach clients over the network; the whole sequence above typically
completes in well under a second once triggered.

## 5. Environment variables

### `apps/server`

| Variable | Required | Default (dev) | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Set to `production` on every real deployment. Also switches the session cookie to cross-site mode — see §6. |
| `PORT` | No | `4000` | Most platforms (Railway, Render) inject their own `PORT` — respect it rather than hardcoding. |
| `WEB_ORIGIN` | **Yes**, in production | `http://localhost:3000` | The exact origin (scheme + host, no trailing slash) of the deployed `apps/web` — used for both HTTP CORS and the Socket.IO CORS config (`index.ts`). Must match exactly; a wildcard is never used here since credentialed (cookie-bearing) requests require an explicit origin. |
| `MONGO_URI` | **Yes**, in production | `mongodb://localhost:27017/mafia` | A MongoDB Atlas connection string (`mongodb+srv://...`) in production. Include the database name in the path. |
| `MONGO_MAX_POOL_SIZE` | No | `20` | Tune down on Atlas's free/shared tiers, which cap total concurrent connections across the whole cluster. |
| `MONGO_MIN_POOL_SIZE` | No | `1` | |
| `MONGO_CONNECT_TIMEOUT_MS` | No | `10000` | |
| `SESSION_SECRET` | **Yes**, in production | `dev-secret-change-me` | HMAC secret signing the session cookie (see `session.ts`). **Must** be overridden in production — the default is intentionally obvious/insecure so it's never mistaken for a real secret. Generate with `openssl rand -base64 32` or similar; keep it stable across deploys (rotating it invalidates every existing player session). |

### `apps/web`

All client-facing env vars are `NEXT_PUBLIC_*` (inlined into the client
bundle at build time — do not put secrets here, there are none needed on
this side).

| Variable | Required | Default (dev) | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Yes**, in production | `http://localhost:4000` | Base URL for REST calls (`lib/api.ts`) — the deployed `apps/server` origin. |
| `NEXT_PUBLIC_SOCKET_URL` | **Yes**, in production | `http://localhost:4000` | Socket.IO connection target (`lib/socket-context.tsx`, `layout.tsx`'s preconnect hint) — normally identical to `NEXT_PUBLIC_API_URL` since both point at the same server. |

Set both on Vercel under Project Settings → Environment Variables, scoped
to Production (and Preview, pointed at a staging server, if you run one).

## 6. CORS and cookies for cross-origin sockets with credentials

This is the single most common way a first deployment breaks, because it
works perfectly in local dev and then fails silently in production. Read
this before debugging a mysterious `UNAUTHENTICATED` in production.

**The setup**: `apps/web` (e.g. `https://mafia.vercel.app`) and
`apps/server` (e.g. `https://mafia-server.up.railway.app`) are different
**sites** in production — not just different ports like local dev, but
different registrable domains entirely. Every request from the browser to
the server — the REST calls in `lib/api.ts` and the Socket.IO handshake —
is genuinely **cross-site**, and carries the session cookie
(`credentials: 'include'` / `withCredentials: true`) that is this app's
only notion of identity (no passwords, no email — see `session.ts`'s
module header).

Three things all have to agree for that to actually work:

1. **CORS must allow the specific origin, with credentials.**
   `http/app.ts` and `index.ts`'s Socket.IO server both set
   `cors: { origin: env.WEB_ORIGIN, credentials: true }`. A wildcard
   origin (`origin: '*'`) is not just discouraged here, it's rejected by
   the browser outright — a credentialed cross-origin request requires an
   **exact** `Access-Control-Allow-Origin` echo, never `*`. This is why
   `WEB_ORIGIN` must be set to the exact deployed web origin (§5) — a
   trailing slash, wrong scheme, or wrong subdomain will silently fail
   every request with no CORS error visible in some browsers' consoles
   (it shows as a generic network failure on the WebSocket handshake).

2. **The client must actually send credentials on every request.**
   Already done: `lib/api.ts` sets `credentials: 'include'` on every
   `fetch`, and `socket-context.tsx` sets `withCredentials: true` on the
   Socket.IO client. Nothing to change here, just noting it as the
   client-side half of the contract.

3. **The cookie itself must be attachable cross-site — this is the
   `SameSite` gotcha.** A cookie's `SameSite` attribute controls whether
   the browser attaches it to a cross-site request at all, independent of
   CORS:
   - `SameSite=Lax` (the sensible default for most apps, and what this
     app uses in **local dev**) only attaches the cookie on same-site
     requests and top-level navigations. It is **silently withheld** on
     cross-site `fetch`/`XHR`/WebSocket requests — exactly the requests
     this app makes in production. A `Lax` cookie would make every
     `createOrResumeSession()` call "succeed" (the server sets a cookie)
     but the browser would never send it back on the next request,
     because the browser started treating it as third-party after the
     JS was actually a resource, so the server can't resolve a session
     and everything past onboarding fails with `UNAUTHENTICATED`.
   - `SameSite=None` is **required** for a cookie to be sent on a
     cross-site request. Browsers additionally **require `Secure: true`**
     on any `SameSite=None` cookie (HTTPS-only) — a non-secure
     `SameSite=None` cookie is rejected outright by modern browsers, not
     just discouraged.

   `session.ts`'s `setSessionCookie` handles this automatically: it sets
   `sameSite: 'none', secure: true` when `NODE_ENV=production`, and
   `sameSite: 'lax', secure: false` otherwise (so local HTTP dev, where
   web and server differ only by port — same-site, not cross-site — keeps
   working without needing HTTPS locally). **The only action this
   requires from you is setting `NODE_ENV=production`** on the deployed
   server (§5) — every platform in §3 does this by default for a
   production deploy, but it's worth confirming explicitly if cookies
   mysteriously aren't round-tripping.

4. **Both origins must be HTTPS in production.** Vercel and
   Railway/Fly/Render all provide HTTPS by default on their generated
   domains — nothing to configure — but if you put a custom domain in
   front of either, make sure TLS termination is in place before
   flipping `NODE_ENV=production`, since `Secure` cookies are refused
   entirely over plain HTTP.

## 7. Structured logging and `/metrics`

Every log line the server emits is a single JSON object on stdout (see
`src/logger.ts`) — `{ timestamp, level, message, ...fields }`. This is
directly ingestible by every platform in §3's log viewer/pipeline without
extra parsing configuration.

`GET /metrics` (mounted at the root, alongside `/health` — not under
`/api`, since it's an operational endpoint rather than part of the
client-facing API) returns:

```json
{ "activeVillages": 3, "activePlayers": 11, "gamesCompleted": 47 }
```

- `activeVillages` / `activePlayers` are read live from the in-memory
  `VillageManager` (this process's own state) — see §8 for why these are
  necessarily **per-instance**, not global, once horizontally scaled.
- `gamesCompleted` is a lifetime count from MongoDB, so it's accurate
  regardless of how many server instances have come and gone.

Point your platform's uptime/monitoring at `GET /health` for liveness and
poll `GET /metrics` on whatever interval your dashboard needs.

## 8. Horizontal scaling — the path not taken (yet)

**This server cannot currently run as more than one instance.** This is a
deliberate, documented limitation, not an oversight — see
`VillageManager.ts`'s own module header. This section explains why, and
what migrating past it would involve. **Nothing below is implemented.**

### Why the current design can't scale horizontally

The authoritative state of every active village — its roster, phase,
votes, chat log, pending night actions, the scheduled phase-advance timer
— lives in a plain in-memory `Map<VillageCode, GameSession>`
(`VillageManager`), owned by a single Node process. MongoDB is
deliberately **not** the source of truth during play (see `db/index.ts`'s
"hot-path boundary" comment) — it's a periodic checkpoint, written only at
phase boundaries and game end, specifically so that per-action latency
(a vote, a chat message, a night-action submission) never round-trips to
the database.

Two things follow directly from that design, and both break the moment
there's more than one server instance behind a load balancer:

1. **Village-to-instance affinity.** A given village's `GameSession` only
   exists in ONE process's memory. If a load balancer routes player A's
   `joinVillage` to instance 1 and player B's `joinVillage` (same village)
   to instance 2, instance 2 has no idea that village exists — it would
   either 404 or, worse, silently create a second, divergent
   `GameSession` for the same village code. Sticky sessions (routing every
   request/socket for a given player, or a given village, to the same
   instance) are necessary but not sufficient — see (2).

2. **Socket.IO's own room/broadcast model is per-process.**
   `io.to(playerChannel(id)).emit(...)` (see `emit.ts`) only reaches
   sockets connected to THIS process's Socket.IO server instance. Two
   players in the same village connected to two different instances
   (even with sticky sessions per-connection, a reconnect can land on a
   different instance than before) would never see each other's
   `stateUpdate`/`chatMessage` events — the broadcast simply never
   crosses the process boundary.

### What the migration would involve

The standard fix for (2) is Socket.IO's own
[Redis adapter](https://socket.io/docs/v4/redis-adapter/) — it makes
`io.to(...).emit(...)` publish through Redis pub/sub, so every instance
subscribed to the same Redis instance receives (and re-emits to its own
locally-connected sockets) every broadcast, regardless of which instance
originated it. That solves cross-instance delivery, but does **not** by
itself solve (1) — the actual `GameSession` state still needs to live
somewhere every instance can read/write it, not just in one process's
memory. Two viable shapes for that:

- **Shared state store** (more invasive): move `GameSession.state` (the
  `FullGameState`) out of `VillageManager`'s in-memory `Map` and into
  Redis itself (or another shared store), with every socket handler
  reading-modifying-writing it there instead of a local object. This
  removes the hot-path-boundary optimization the current design leans on
  (see `db/index.ts`) — every action would now pay a network round trip
  to Redis, though still far cheaper than one to MongoDB. The phase-timer
  scheduling (`scheduler.ts`'s `setTimeout`) would also need to move to
  something distributed (e.g. a Redis-backed job/lock so only one
  instance's timer actually fires the phase transition, not one per
  instance racing each other).
- **Sticky routing + Redis adapter only** (less invasive, but fragile):
  keep `GameSession` state in-memory per-instance as today, but pin every
  socket for a given village to the same instance via the load balancer's
  session affinity (consistent hashing on village code, or a sticky
  cookie), and use the Redis adapter purely so a REST request that lands
  on the "wrong" instance can still be proxied/redirected. This avoids
  rewriting the hot-path state model, but a lost/rebalanced sticky route
  (an instance restarting, a deploy) still orphans every village pinned
  to it — the exact crash-recovery problem `realtime/restart.ts` already
  solves for a *single* instance would need to be re-solved for
  *instance failure*, not just process restart.

Given this app's actual scale target (a party game played by one table's
worth of players per village, not a platform serving millions of
concurrent villages), a single well-resourced instance is very likely
sufficient indefinitely — this section exists so that if/when it isn't,
the reasoning and the two real options are already written down, not
something to be rediscovered under production pressure.
