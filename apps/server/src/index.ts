import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@mafia/shared';
import { env } from './env';
import { getDb, ensureCollections, registerGracefulShutdown } from './db';
import { createApp } from './http/app';
import { attachRealtime } from './realtime';
import { abandonAllActiveGames, recoverInProgressGames } from './realtime/restart';
import { notifyActiveGames } from './realtime/shutdown';
import { logger } from './logger';

const app = createApp();

const httpServer = createServer(app);

// Only the configured web origin is allowed — the server is the sole
// source of truth for game state, so no other origin should ever be able
// to open a socket and receive redacted-per-recipient payloads meant for a
// player. Same trust boundary as the HTTP layer's CORS config.
const io = new SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: env.WEB_ORIGIN, credentials: true },
});

attachRealtime(io);

async function main() {
  // Connect and provision indexes/validators before accepting traffic —
  // fail boot loudly rather than accept connections a broken DB can't serve.
  const db = await getDb();
  await ensureCollections(db);

  // Recover from a prior crash BEFORE accepting any traffic: resume every
  // still-IN_GAME village's game where possible, abandon the rest. See
  // realtime/restart.ts for the resume-vs-abandon rule.
  await recoverInProgressGames(io);

  // Graceful shutdown, in strict order (see realtime/shutdown.ts's module
  // header for the full rationale):
  //   1. Stop accepting new connections — bounds how long shutdown can
  //      take, and stops a player joining mid-drain just to be booted.
  //   2. Notify every player in an active game.
  //   3. Persist ABANDONED for every in-memory session (this is
  //      `beforeClose`, run by registerGracefulShutdown itself).
  //   4. Close the Mongo pool (also inside registerGracefulShutdown).
  //   5. Exit.
  registerGracefulShutdown(async () => {
    await stopAcceptingConnections();
    notifyActiveGames(io);
    await abandonAllActiveGames();
  });

  httpServer.listen(env.PORT, () => {
    // `lanAddresses` is purely a local-dev convenience: it's how a phone or
    // another device on the same network finds this server (127.0.0.1 in a
    // browser only ever reaches the machine it's opened on, so "it works on
    // my laptop but not my phone" is almost always someone using localhost
    // instead of one of these). Deployed environments (Railway/Fly/Render —
    // see the deployment doc) sit behind a real hostname and don't need
    // this; `getLanAddresses` still runs there but its output is simply
    // unused/ignored in favor of the platform's own routing.
    logger.info('server listening', { port: env.PORT, lanAddresses: getLanAddresses(env.PORT) });
  });
}

/** Closes the HTTP server (stops accepting new TCP connections; Socket.IO's
 * engine.io transport rides on the same server, so this also stops new
 * socket upgrades) and resolves once it's actually closed. Does NOT forcibly
 * disconnect already-open sockets — those are handled explicitly by
 * `notifyActiveGames` + the natural close that happens once the process
 * exits, so a player mid-action gets a clean notification rather than a
 * silently dropped connection. */
function stopAcceptingConnections(): Promise<void> {
  return new Promise((resolve) => {
    httpServer.close(() => resolve());
    // `close()` only stops NEW connections; it does not close this one on
    // its own. Nothing further to do here — notifyActiveGames (called
    // right after this resolves) is what tells already-open sockets
    // what's happening, and the process exit that follows is what
    // actually tears them down.
  });
}

/** Every non-internal IPv4 address this machine currently has, formatted as
 * `http://<address>:<port>` — i.e. the URLs another device on the same LAN
 * (a phone testing the web app against this server, say) could actually
 * reach, as opposed to `localhost`/`127.0.0.1`, which only ever resolves to
 * "this machine" no matter who's asking. Skips internal/loopback interfaces
 * (`iface.internal`) and IPv6 (LAN testing here is IPv4 in practice, and an
 * IPv6 link-local address usually needs a zone index to be reachable
 * anyway, which would just be one more thing to explain). */
function getLanAddresses(port: number): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const entry of iface ?? []) {
      if (!entry.internal && entry.family === 'IPv4') {
        addresses.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return addresses;
}

main().catch((err) => {
  logger.error('fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
