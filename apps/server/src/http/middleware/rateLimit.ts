// ---------------------------------------------------------------------------
// Rate limiting. Village creation is the primary abuse vector (an attacker
// scripting POST /api/villages to exhaust the code keyspace, spam the DB, or
// grief other players), so it gets its own, stricter limiter layered on top
// of a general per-IP limiter applied to the whole API.
//
// Two independent dimensions are limited, both active on village creation:
//   - per IP: catches a single attacker regardless of how many sessions
//     they mint.
//   - per session: catches an attacker who rotates IPs (or sits behind a
//     shared IP, e.g. NAT/VPN/corporate proxy) but keeps reusing session
//     cookies faster than a real host in a real party game plausibly would.
// A request needs a session established (attachSession must run first) for
// the per-session limiter to key on anything meaningful; unauthenticated
// requests fall through to per-IP only, which is still enforced.
// ---------------------------------------------------------------------------

import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { AppError } from '../errors';

/** express-rate-limit calls this on limit-exceeded; translate into the same
 * AppError -> centralized error handler path everything else uses, instead
 * of the library's own default JSON shape. */
function rateLimitHandler(): never {
  throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.');
}

const sharedOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next, _opts) => {
    try {
      rateLimitHandler();
    } catch (err) {
      next(err);
    }
  },
};

/** General-purpose per-IP limiter, applied to the entire /api surface. */
export const apiRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  limit: 60,
});

/** Stricter per-IP limiter specifically for village creation. */
export const createVillageIpRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 10 * 60 * 1000,
  limit: 10,
});

/** Per-session limiter for village creation — keyed on the session cookie's
 * player id rather than IP, so it still bites an attacker with many IPs
 * but one (or a small rotating set of) session token(s). Requests with no
 * resolved session are keyed under a single shared bucket; that bucket is
 * intentionally tight since a legitimate village-creation flow always POSTs
 * /api/session first and will have a `req.player` by this point. */
export const createVillageSessionRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: (req: Request) => req.player?._id ?? 'no-session',
});
