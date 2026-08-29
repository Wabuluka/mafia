// ---------------------------------------------------------------------------
// GET /metrics — a small operational snapshot for uptime/dashboard
// monitoring (not a Prometheus exposition-format endpoint; deliberately
// plain JSON since this app has exactly three numbers worth watching and
// no existing Prometheus scrape target to speak that format to). Mounted
// at the root, alongside /health, not under /api — same reasoning as
// /health: it's an operational endpoint for the platform/monitoring, not
// part of the client-facing API surface, and shouldn't be subject to the
// API's CORS/rate-limit/session middleware stack (see http/app.ts's
// middleware order comment).
//
// Numbers reported:
//   activeVillages — count of in-memory VillageManager sessions, i.e.
//     every lobby or in-progress game this PROCESS currently holds. In a
//     single-instance deployment (the only topology this app currently
//     supports — see VillageManager.ts's module header) this is the
//     whole picture; once horizontally scaled, per-instance /metrics would
//     each report a slice, not the global total (see the horizontal-
//     scaling doc for the Redis-adapter path that would fix this).
//   activePlayers — sum of connected sockets across all active sessions
//     (`session.sockets.size`), NOT the roster size — a player who left
//     their tab open but disconnected still counts as roster, but
//     shouldn't count as "active" for this snapshot.
//   gamesCompleted — lifetime count of COMPLETED games from MongoDB (see
//     games.repository.ts's countCompletedGames), which persists across
//     restarts, unlike the two in-memory figures above.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { gamesRepository } from '../../db';
import { env } from '../../env';
import { villageManager } from '../../realtime';
import { asyncRoute } from '../middleware/errorHandler';

export const metricsRouter = Router();

// Gated by METRICS_TOKEN when set (see env.ts) — this endpoint has no other
// auth or rate limiting (see the module header above), so an operator who
// sets the token expects a bearer check here, not an open door. Left as a
// no-op when the token isn't configured, preserving the original "open in
// dev" behavior rather than breaking local setups that never set it.
metricsRouter.get(
  '/metrics',
  (req, res, next) => {
    if (!env.METRICS_TOKEN) {
      next();
      return;
    }
    const provided = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== env.METRICS_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  },
  asyncRoute(async (_req, res) => {
    let activeVillages = 0;
    let activePlayers = 0;
    for (const session of villageManager.all()) {
      activeVillages += 1;
      activePlayers += session.sockets.size;
    }

    const gamesCompleted = await gamesRepository.countCompletedGames();

    res.status(200).json({ activeVillages, activePlayers, gamesCompleted });
  }),
);
