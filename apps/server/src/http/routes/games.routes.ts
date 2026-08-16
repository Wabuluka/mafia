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
import { gamesRepository } from '../../db';
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
      roomCode: game.roomCode,
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
