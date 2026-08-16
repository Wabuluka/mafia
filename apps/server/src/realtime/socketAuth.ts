// ---------------------------------------------------------------------------
// Socket.IO handshake authentication. Reuses the exact same signed session
// cookie the HTTP layer issues (see http/middleware/session.ts) — a socket
// connection is only accepted if it presents a cookie that verifies against
// SESSION_SECRET and resolves to a real player. Unknown/missing/tampered
// sessions are rejected during the handshake, before `connection` fires, so
// no unauthenticated socket ever reaches a village handler.
// ---------------------------------------------------------------------------

import cookie from 'cookie';
import { signedCookie } from 'cookie-parser';
import type { Socket } from 'socket.io';
import { playersRepository } from '../db';
import type { PlayerDocument } from '../db/types';
import { env } from '../env';
import { SESSION_COOKIE_NAME } from '../http/middleware/session';

declare module 'socket.io' {
  interface Socket {
    player: PlayerDocument;
  }
}

/** Extracts and verifies the session cookie from a raw handshake cookie
 * header, returning the resolved player or `undefined` if the cookie is
 * absent, malformed, fails signature verification, or doesn't resolve to a
 * known player. Never throws — every failure mode collapses to "reject the
 * connection", handled uniformly by the caller. */
async function resolvePlayerFromCookieHeader(cookieHeader: string | undefined): Promise<PlayerDocument | undefined> {
  if (!cookieHeader) return undefined;

  const parsed = cookie.parse(cookieHeader);
  const raw = parsed[SESSION_COOKIE_NAME];
  if (!raw) return undefined;

  // cookie-parser signs cookies as `s:<value>.<hmac>`; `signedCookie`
  // verifies the HMAC against SESSION_SECRET and returns the bare token on
  // success, or `false` on a bad/missing signature — the same contract
  // `attachSession` relies on for the HTTP side (see session.ts).
  const token = signedCookie(raw, env.SESSION_SECRET);
  if (!token) return undefined;

  const player = await playersRepository.findPlayerBySessionToken(token);
  return player ?? undefined;
}

/**
 * Socket.IO middleware (registered via `io.use`) that authenticates the
 * handshake. Rejects the connection outright — `next(new Error(...))` —
 * for any request that doesn't resolve to a known player, rather than
 * letting an anonymous socket connect and only failing individual events
 * later. This is what "reject unknown sessions" means at the transport
 * level: no `connection` event ever fires for a socket that failed this.
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const player = await resolvePlayerFromCookieHeader(socket.handshake.headers.cookie);
    if (!player) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    socket.player = player;
    next();
  } catch {
    next(new Error('INTERNAL_ERROR'));
  }
}
