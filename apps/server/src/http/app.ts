// ---------------------------------------------------------------------------
// Express app assembly for the /api surface: security headers, compression,
// cookies, request tracing, session resolution, rate limiting, routes, and
// finally the centralized error handler. Middleware order matters and is
// deliberate — see the inline comments below before reordering anything.
// ---------------------------------------------------------------------------

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '../env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimit';
import { requestId, requestLogger } from './middleware/requestId';
import { attachSession } from './middleware/session';
import { gamesRouter } from './routes/games.routes';
import { villagesRouter } from './routes/villages.routes';
import { sessionRouter } from './routes/session.routes';

export function createApp(): Express {
  const app = express();

  // Request id first: every later middleware/handler/log line can rely on
  // req.requestId already being set.
  app.use(requestId);
  app.use(requestLogger);

  // Security headers before anything touches the response.
  app.use(helmet());

  // Only the configured web origin may send credentialed (cookie-bearing)
  // requests — same trust boundary as the socket layer.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.use(compression());

  // Signed cookie parsing needs SESSION_SECRET before `attachSession` (or
  // any route) can read `req.signedCookies`.
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '32kb' })); // small ceiling — this API never needs large bodies

  // Resolve (but do not require) a session on every request; individual
  // routes opt into `requireSession` when they need one.
  app.use(attachSession);

  // General per-IP budget for the whole API surface. Village creation layers
  // its own stricter limiters on top of this (see villages.routes.ts).
  app.use('/api', apiRateLimiter);

  app.use('/api', sessionRouter);
  app.use('/api', villagesRouter);
  app.use('/api', gamesRouter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api', notFoundHandler);

  // Error handler is always last.
  app.use(errorHandler);

  return app;
}
