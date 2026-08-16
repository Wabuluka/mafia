// ---------------------------------------------------------------------------
// Room lifecycle over HTTP: create, fetch lobby metadata, join. Real-time
// lobby updates (player list changes, ready toggles) happen over the
// socket layer once a player has joined — these endpoints are the entry
// door, not the ongoing channel.
// ---------------------------------------------------------------------------

import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { MAX_PLAYERS, MIN_PLAYERS, RoomCodeSchema } from '@mafia/shared';
import { roomsRepository } from '../../db';
import type { PlayerDocument } from '../../db/types';
import { AppError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import { createRoomIpRateLimiter, createRoomSessionRateLimiter } from '../middleware/rateLimit';
import { requireSession } from '../middleware/session';
import { validate } from '../middleware/validate';
import { generateUniqueRoomCode } from '../roomCode';

export const roomsRouter = Router();

/** Narrows `req.player` from optional to required. Safe to call only after
 * `requireSession` has already run on this route — it throws otherwise,
 * which should be unreachable in practice but keeps this honest rather
 * than silently trusting a non-null assertion. */
function requirePlayer(req: Request): PlayerDocument {
  if (!req.player) {
    throw new AppError('UNAUTHENTICATED', 'A session is required for this endpoint.');
  }
  return req.player;
}

const CreateRoomBodySchema = z.object({
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MAX_PLAYERS),
  minPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MIN_PLAYERS),
});

roomsRouter.post(
  '/rooms',
  requireSession,
  createRoomIpRateLimiter,
  createRoomSessionRateLimiter,
  validate(CreateRoomBodySchema),
  asyncRoute(async (req, res) => {
    const body = req.body as z.infer<typeof CreateRoomBodySchema>;
    if (body.minPlayers > body.maxPlayers) {
      throw new AppError('VALIDATION_ERROR', 'minPlayers cannot exceed maxPlayers.');
    }

    const hostId = requirePlayer(req)._id;
    const code = await generateUniqueRoomCode();
    const room = await roomsRepository.createRoom({
      code,
      hostId,
      maxPlayers: body.maxPlayers,
      minPlayers: body.minPlayers,
    });

    res.status(201).json({
      code: room._id,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      playerCount: room.playerIds.length,
      status: room.status,
    });
  }),
);

const RoomCodeParamsSchema = z.object({ code: RoomCodeSchema });

/**
 * Lobby metadata only. Deliberately returns nothing about game state — no
 * phase, no round number, no player roles, not even whether a game
 * document exists for this room. A room `IN_GAME` reports only that status
 * word; a client watching this endpoint learns "you can't join right now"
 * and nothing else about what's happening inside.
 */
roomsRouter.get(
  '/rooms/:code',
  validate(RoomCodeParamsSchema, 'params'),
  asyncRoute(async (req, res) => {
    const { code } = req.params as unknown as z.infer<typeof RoomCodeParamsSchema>;
    const room = await roomsRepository.findRoomByCode(code);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', `No room found with code ${code}.`);
    }

    res.status(200).json({
      code: room._id,
      status: room.status,
      playerCount: room.playerIds.length,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
    });
  }),
);

const JoinRoomBodySchema = z.object({}).strict();

roomsRouter.post(
  '/rooms/:code/join',
  requireSession,
  validate(RoomCodeParamsSchema, 'params'),
  validate(JoinRoomBodySchema),
  asyncRoute(async (req, res) => {
    const { code } = req.params as unknown as z.infer<typeof RoomCodeParamsSchema>;
    const room = await roomsRepository.findRoomByCode(code);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', `No room found with code ${code}.`);
    }
    if (room.status === 'IN_GAME') {
      throw new AppError('GAME_IN_PROGRESS', 'This room already has a game in progress.');
    }
    if (room.status === 'CLOSED') {
      throw new AppError('ROOM_NOT_FOUND', `No room found with code ${code}.`);
    }

    const playerId = requirePlayer(req)._id;
    const alreadyMember = room.playerIds.includes(playerId);
    if (!alreadyMember && room.playerIds.length >= room.maxPlayers) {
      throw new AppError('ROOM_FULL', 'This room is already at capacity.');
    }

    if (!alreadyMember) {
      await roomsRepository.addPlayerToRoom(code, playerId);
    }

    const updated = await roomsRepository.findRoomByCode(code);
    if (!updated) {
      // Unreachable in practice — we just wrote to this exact document —
      // but treated as a real error rather than asserted away, in case a
      // concurrent deletion (room close) raced this request.
      throw new AppError('ROOM_NOT_FOUND', `No room found with code ${code}.`);
    }

    res.status(200).json({
      code: updated._id,
      status: updated.status,
      playerCount: updated.playerIds.length,
      maxPlayers: updated.maxPlayers,
      minPlayers: updated.minPlayers,
    });
  }),
);
