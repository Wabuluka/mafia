// ---------------------------------------------------------------------------
// Anonymous session resolution. A session is nothing more than an opaque
// random token stored in a signed httpOnly cookie, resolved to a
// `PlayerDocument` (see db/repositories/players.repository.ts). No
// password, no email — the cookie itself, once issued, IS the credential,
// which is why it's `httpOnly` (no JS access) and cryptographically signed
// (a client can't forge or tamper with a token and have it accepted).
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { playersRepository } from '../../db';
import type { PlayerDocument } from '../../db/types';
import { env } from '../../env';
import { AppError } from '../errors';

export const SESSION_COOKIE_NAME = 'mafia_session';
const SESSION_TOKEN_BYTES = 32; // 256 bits — well past the JSON Schema's minLength(16) floor

declare module 'express-serve-static-core' {
  interface Request {
    /** Present once `attachSession` has run and resolved a valid cookie to
     * a player. Absent for a request with no/invalid session cookie —
     * routes that require auth should use `requireSession` instead of
     * checking this directly. */
    player?: PlayerDocument;
  }
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** Clears the session cookie. `secure`/`sameSite` here MUST mirror
 * `setSessionCookie` exactly — a `clearCookie` call with different
 * attributes doesn't match the cookie the browser actually holds and is
 * silently a no-op (the browser keys a cookie by name+domain+path, but
 * Express's cookie deletion is really just re-setting it with an
 * already-expired date, so the attributes still have to line up for the
 * browser to treat it as the same cookie). */
export function clearSessionCookie(res: Response): void {
  const crossSite = env.NODE_ENV === 'production';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    signed: true,
    secure: crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
  });
}

/** Sets the signed httpOnly session cookie. `secure`/`sameSite` are only
 * forced to their cross-origin-capable values in production so local HTTP
 * dev (web on :3000, server on :4000 — technically cross-PORT, which
 * browsers treat as same-SITE, not cross-site) keeps working without HTTPS.
 *
 * PRODUCTION IS CROSS-ORIGIN BY DEFAULT for this app's documented
 * deployment topology (see docs/DEPLOYMENT.md): the Next app on Vercel and
 * this server on Railway/Fly/Render are different eTLD+1 domains, not just
 * different ports — genuinely cross-SITE, not merely cross-origin. A
 * `sameSite: 'lax'` cookie is silently withheld by the browser on
 * cross-site fetch/XHR/WebSocket requests (`lax` only attaches on
 * top-level navigation), which would make every credentialed
 * `fetch(..., { credentials: 'include' })` call in lib/api.ts and the
 * Socket.IO handshake's cookie auth (socketAuth.ts) fail closed with
 * UNAUTHENTICATED in production despite working perfectly in local dev —
 * exactly the kind of bug that only surfaces after a real deployment.
 * `sameSite: 'none'` is REQUIRED for a cross-site cookie to be sent at
 * all, and browsers additionally require `secure: true` on any
 * `sameSite: 'none'` cookie (rejected outright otherwise) — hence both
 * being forced together, not independently, in production. */
export function setSessionCookie(res: Response, token: string): void {
  const crossSite = env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    secure: crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    // 180 days — this is the anonymous identity persisting "across
    // reconnects and reloads", not a short-lived auth token.
    maxAge: 180 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/**
 * Best-effort session resolution: if a valid, signed session cookie is
 * present and resolves to a known player, attaches it to `req.player`.
 * Never rejects the request — routes that don't require a session (e.g.
 * GET /api/villages/:code) can still run for an anonymous, session-less
 * visitor. Routes that DO require a session use `requireSession` below.
 */
export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.signedCookies?.[SESSION_COOKIE_NAME] as string | false | undefined;
    // `false` is cookie-parser's signal for "present but failed signature
    // verification" — treat identically to "absent" rather than trusting it.
    if (!token) {
      next();
      return;
    }
    const player = await playersRepository.findPlayerBySessionToken(token);
    if (player) {
      req.player = player;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard for endpoints that require an established anonymous
 * session (e.g. creating a village). Throws a typed 401 via AppError, caught
 * by the centralized error handler, rather than each route re-implementing
 * the same check. */
export function requireSession(req: Request, _res: Response, next: NextFunction): void {
  if (!req.player) {
    next(new AppError('UNAUTHENTICATED', 'A session is required for this endpoint. Call POST /api/session first.'));
    return;
  }
  next();
}
