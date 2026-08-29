// ---------------------------------------------------------------------------
// Centralized error handler — the single place an error becomes an HTTP
// response. Every route/middleware should let errors reach here via
// `next(err)` (or an async handler wrapped in `asyncRoute`, see below)
// rather than formatting its own error response.
//
// Response shape is always:
//   { error: { code: string, message: string, requestId: string, details?: unknown } }
//
// Stack traces (and any AppError.details for an unclassified/internal
// error) are NEVER included in a production response — only in the server
// log line, keyed by requestId for correlation.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { env } from '../../env';
import { logger } from '../../logger';

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** Wraps an async Express handler so a rejected promise is forwarded to
 * `next()` instead of becoming an unhandled rejection. Express 4 (in use
 * here) does not do this automatically. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? 'unknown';

  if (err instanceof AppError) {
    logger.warn(err.message, { requestId, code: err.code });
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message, requestId, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  // Unclassified error: never trust its message or expose its stack to the
  // client, even outside production — a message an internal library chose
  // to throw with is not vetted for client consumption. Log the real thing
  // server-side, keyed by requestId, so it's diagnosable without leaking it.
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error(message, { requestId, stack: env.NODE_ENV === 'production' ? undefined : stack });

  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  };
  res.status(500).json(body);
}

/** 404 fallback for any /api route that didn't match. Kept separate from
 * the error handler since it's not an "error" per se, but should still
 * produce the same response envelope for a consistent client experience. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ErrorResponseBody = {
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: req.requestId ?? 'unknown',
    },
  };
  res.status(404).json(body);
}
