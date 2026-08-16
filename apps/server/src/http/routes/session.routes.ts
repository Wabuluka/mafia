// ---------------------------------------------------------------------------
// POST /api/session — issues (or resumes) an anonymous session. No
// passwords, no email. The httpOnly signed cookie is the only credential;
// the response body returns the playerId so the client can address itself
// in socket handshakes and API calls without ever reading the cookie
// (it can't — httpOnly).
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { z } from 'zod';
import { playersRepository } from '../../db';
import { asyncRoute } from '../middleware/errorHandler';
import { generateSessionToken, setSessionCookie, SESSION_COOKIE_NAME } from '../middleware/session';
import { validate } from '../middleware/validate';

const CreateSessionBodySchema = z.object({
  // A player picks a display name up front; if they reconnect with an
  // existing valid session cookie, this is ignored in favor of their
  // already-established identity rather than silently renaming them.
  displayName: z.string().trim().min(1).max(24).optional(),
});

export const sessionRouter = Router();

sessionRouter.post(
  '/session',
  validate(CreateSessionBodySchema),
  asyncRoute(async (req, res) => {
    const body = req.body as z.infer<typeof CreateSessionBodySchema>;

    // Resuming an existing, still-valid session (attachSession already ran
    // globally and would have populated req.player) is idempotent: return
    // the same identity rather than minting a new one underneath a cookie
    // the browser already has.
    if (req.player) {
      res.status(200).json({ playerId: req.player._id, displayName: req.player.displayName, resumed: true });
      return;
    }

    const token = generateSessionToken();
    const displayName = body.displayName ?? `Player${Math.floor(Math.random() * 10_000)}`;
    const player = await playersRepository.createPlayer(token, displayName);

    setSessionCookie(res, token);
    res.status(201).json({ playerId: player._id, displayName: player.displayName, resumed: false });
  }),
);

// Exported for the rest of the router tree / tests that need the cookie
// name without importing the whole session middleware module.
export { SESSION_COOKIE_NAME };
