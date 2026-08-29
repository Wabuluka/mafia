// ---------------------------------------------------------------------------
// Graceful shutdown for the realtime layer. Call `notifyActiveGames(io)`
// as the FIRST step of a SIGTERM/SIGINT handler — before the HTTP server
// stops listening and before `abandonAllActiveGames` (restart.ts) persists
// anything — so every connected player gets a chance to see a clear
// message instead of the socket just dying with no explanation.
//
// SHUTDOWN ORDER (see index.ts for the actual wiring):
//   1. Stop accepting NEW connections (`httpServer.close()` + closing the
//      Socket.IO engine to new upgrades) so shutdown duration is bounded —
//      nobody can join mid-drain and be immediately kicked back off.
//   2. notifyActiveGames(io) — tell every socket in an active game the
//      server is going away (this module).
//   3. abandonAllActiveGames() (restart.ts) — persist ABANDONED for every
//      in-memory session, so the next boot's recoverInProgressGames never
//      has to guess whether an IN_PROGRESS game document means "still
//      running elsewhere" or "died here".
//   4. closeDb() (db/connection.ts) — close the Mongo pool last, after
//      every write above has had a chance to land.
//   5. process.exit(0).
//
// Only players in an ACTIVE GAME are notified — a lobby has no persisted
// game document and nothing "abandoned" happens to it (see
// abandonAllActiveGames, which only touches sessions with a `gameId`), so
// a lobby-only player losing their socket gets the normal client-side
// reconnect treatment rather than a scary "server restarting" message for
// something that cost them nothing.
// ---------------------------------------------------------------------------

import { villageManager } from './VillageManager';
import type { GameServer } from './emit';
import { playerChannel } from './emit';

const SHUTDOWN_MESSAGE = 'The server is restarting for maintenance. Please rejoin in a moment.';

/** Emits `serverShuttingDown` to every connected player currently in an
 * active game (a session with a `gameId` — see the module header for why
 * lobby-only sessions are excluded). Best-effort: does not wait for
 * delivery/ack, since Socket.IO offers no such thing and the process is
 * about to close every connection anyway. */
export function notifyActiveGames(io: GameServer): void {
  for (const session of villageManager.all()) {
    if (!session.gameId) continue; // lobby-only — nothing "active" to warn about
    for (const playerId of session.sockets.keys()) {
      io.to(playerChannel(playerId)).emit('serverShuttingDown', { message: SHUTDOWN_MESSAGE });
    }
  }
}
