import { createServer } from 'http';
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
  // still-IN_GAME room's game where possible, abandon the rest. See
  // realtime/restart.ts for the resume-vs-abandon rule.
  await recoverInProgressGames(io);

  // A clean shutdown always explicitly abandons whatever's still running,
  // rather than leaving the next boot's crash-recovery pass to guess.
  registerGracefulShutdown(abandonAllActiveGames);

  httpServer.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal startup error', err);
  process.exit(1);
});
