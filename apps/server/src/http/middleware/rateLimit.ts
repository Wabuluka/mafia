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
import { env } from '../../env';
import { AppError } from '../errors';

// In local dev, a single developer reloading tabs/HMR'ing repeatedly can
// trivially blow past limits sized for production abuse-prevention (a real
// browser session fires POST /api/session + GET /api/villages/:code on
// every mount, and StrictMode/fast-refresh multiplies that further) — none
// of that is the abuse this limiter exists to catch. Multiplying every
// limit's `limit` by this factor in development keeps the SAME windows
// (so the shape of the limiter is still exercised/testable) while making
// them generous enough not to interrupt normal local testing. Production
// (and test, so CI/integration tests keep exercising the real limits) are
// unaffected.
const DEV_LIMIT_MULTIPLIER = env.NODE_ENV === 'development' ? 20 : 1;

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
  limit: 60 * DEV_LIMIT_MULTIPLIER,
});

/** Stricter per-IP limiter specifically for village creation. */
export const createVillageIpRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 10 * 60 * 1000,
  limit: 10 * DEV_LIMIT_MULTIPLIER,
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
  limit: 5 * DEV_LIMIT_MULTIPLIER,
  keyGenerator: (req: Request) => req.player?._id ?? 'no-session',
});
