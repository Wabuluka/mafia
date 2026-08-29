// ---------------------------------------------------------------------------
// GET /api/games/:id/summary — the post-game reveal. Everything this
// endpoint returns (every player's real role) is exactly what
// redactStateFor (see engine/redact.ts) exists to withhold DURING a game.
// The only thing that makes it safe to serve here is the explicit
// `status === 'COMPLETED'` check below — a game that is still IN_PROGRESS
// or was ABANDONED never reaches the response body, full stop.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { z } from 'zod';
import { gameEventsRepository, gamesRepository } from '../../db';
import { AppError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

export const gamesRouter = Router();

const GameIdParamsSchema = z.object({ id: z.string().uuid() });

gamesRouter.get(
  '/games/:id/summary',
  validate(GameIdParamsSchema, 'params'),
  asyncRoute(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof GameIdParamsSchema>;
    const game = await gamesRepository.findGameById(id);
    if (!game) {
      throw new AppError('GAME_NOT_FOUND', `No game found with id ${id}.`);
    }

    // The gate: roles/results only ever leave this handler for a game that
    // has actually finished. IN_PROGRESS and ABANDONED both fail closed.
    if (game.status !== 'COMPLETED') {
      throw new AppError('GAME_NOT_FINISHED', 'This game has not finished yet.');
    }

    res.status(200).json({
      gameId: game._id,
      villageCode: game.villageCode,
      endReason: game.endReason,
      winningTeam: game.winningTeam,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        status: p.status,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/games/:id/events — the full ordered gameEvents log for a
// finished game, for the post-game timeline (each night's actions, each
// day's vote breakdown, who voted for whom). Same COMPLETED gate as
// /summary above and for the same reason: NIGHT_ACTION/VOTE events carry
// exactly the actor/target detail redactStateFor exists to withhold while
// a game is still live (e.g. who a mafia player targeted). Once the game
// has ended there's no one left for that information to be hidden from.
// ---------------------------------------------------------------------------

gamesRouter.get(
  '/games/:id/events',
  validate(GameIdParamsSchema, 'params'),
  asyncRoute(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof GameIdParamsSchema>;
    const game = await gamesRepository.findGameById(id);
    if (!game) {
      throw new AppError('GAME_NOT_FOUND', `No game found with id ${id}.`);
    }
    if (game.status !== 'COMPLETED') {
      throw new AppError('GAME_NOT_FINISHED', 'This game has not finished yet.');
    }

    const events = await gameEventsRepository.findEventsForGame(id);

    res.status(200).json({
      gameId: game._id,
      events: events.map((e) => ({
        sequence: e.sequence,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
    });
  }),
);
