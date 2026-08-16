// ---------------------------------------------------------------------------
// Assigns a request id to every inbound HTTP request (reusing an inbound
// `X-Request-Id` header when a trusted upstream proxy already set one, so a
// request can be traced end-to-end through a load balancer). Echoes it back
// on the response header and logs one line per request carrying it, so any
// log line can be correlated back to the request that produced it.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && inbound.length <= 128 ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** One structured log line per request, emitted on `finish` so it includes
 * the final status code and duration — not just the fact a request arrived. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  });
  next();
}
