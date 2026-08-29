// ---------------------------------------------------------------------------
// Village lifecycle over HTTP: create, fetch lobby metadata, join. Real-time
// lobby updates (player list changes, ready toggles) happen over the
// socket layer once a player has joined — these endpoints are the entry
// door, not the ongoing channel.
// ---------------------------------------------------------------------------

import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { MAX_PLAYERS, MIN_PLAYERS, VillageCodeSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import type { PlayerDocument } from '../../db/types';
import { AppError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import { createVillageIpRateLimiter, createVillageSessionRateLimiter } from '../middleware/rateLimit';
import { requireSession } from '../middleware/session';
import { validate } from '../middleware/validate';
import { generateUniqueVillageCode } from '../villageCode';
import { generateDefaultVillageName } from '../villageName';

export const villagesRouter = Router();

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

const CreateVillageBodySchema = z.object({
  // Purely cosmetic (see VillageDocument.name's doc comment) — omitted
  // entirely gets a generated default (generateDefaultVillageName) rather
  // than being required, so "just create a village" stays a one-tap action
  // for a host who doesn't care to name it.
  name: z.string().trim().min(1).max(40).optional(),
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MAX_PLAYERS),
  minPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MIN_PLAYERS),
});

villagesRouter.post(
  '/villages',
  requireSession,
  createVillageIpRateLimiter,
  createVillageSessionRateLimiter,
  validate(CreateVillageBodySchema),
  asyncRoute(async (req, res) => {
    const body = req.body as z.infer<typeof CreateVillageBodySchema>;
    if (body.minPlayers > body.maxPlayers) {
      throw new AppError('VALIDATION_ERROR', 'minPlayers cannot exceed maxPlayers.');
    }

    const hostId = requirePlayer(req)._id;
    const code = await generateUniqueVillageCode();
    const village = await villagesRepository.createVillage({
      code,
      name: body.name ?? generateDefaultVillageName(),
      hostId,
      maxPlayers: body.maxPlayers,
      minPlayers: body.minPlayers,
    });

    res.status(201).json({
      code: village._id,
      name: village.name,
      hostId: village.hostId,
      maxPlayers: village.maxPlayers,
      minPlayers: village.minPlayers,
      playerCount: village.playerIds.length,
      status: village.status,
    });
  }),
);

const VillageCodeParamsSchema = z.object({ code: VillageCodeSchema });

/**
 * Lobby metadata only. Deliberately returns nothing about game state — no
 * phase, no round number, no player roles, not even whether a game
 * document exists for this village. A village `IN_GAME` reports only that status
 * word; a client watching this endpoint learns "you can't join right now"
 * and nothing else about what's happening inside.
 */
villagesRouter.get(
  '/villages/:code',
  validate(VillageCodeParamsSchema, 'params'),
  asyncRoute(async (req, res) => {
    const { code } = req.params as unknown as z.infer<typeof VillageCodeParamsSchema>;
    const village = await villagesRepository.findVillageByCode(code);
    if (!village) {
      throw new AppError('VILLAGE_NOT_FOUND', `No village found with code ${code}.`);
    }

    res.status(200).json({
      code: village._id,
      name: village.name,
      status: village.status,
      playerCount: village.playerIds.length,
      maxPlayers: village.maxPlayers,
      minPlayers: village.minPlayers,
    });
  }),
);

const JoinVillageBodySchema = z.object({}).strict();

villagesRouter.post(
  '/villages/:code/join',
  requireSession,
  validate(VillageCodeParamsSchema, 'params'),
  validate(JoinVillageBodySchema),
  asyncRoute(async (req, res) => {
    const { code } = req.params as unknown as z.infer<typeof VillageCodeParamsSchema>;
    const village = await villagesRepository.findVillageByCode(code);
    if (!village) {
      throw new AppError('VILLAGE_NOT_FOUND', `No village found with code ${code}.`);
    }
    if (village.status === 'CLOSED') {
      throw new AppError('VILLAGE_NOT_FOUND', `No village found with code ${code}.`);
    }

    const playerId = requirePlayer(req)._id;
    const alreadyMember = village.playerIds.includes(playerId);
    const alreadyPending = village.pendingPlayerIds.includes(playerId);

    // A game already IN_GAME only blocks a genuinely NEW player from
    // joining — someone already on the roster (e.g. their tab closed/
    // crashed mid-game and they're coming back in via the Join screen
    // rather than a bookmarked /game/:code link) is reconnecting to a
    // game they're already part of, not joining a new one, and must be
    // let back in. The realtime layer already treats this identically —
    // joinVillage.ts's own membership check has never distinguished "mid-
    // game" from "lobby" for an existing member — this route was the only
    // place still rejecting the resume case outright.
    if (village.status === 'IN_GAME' && !alreadyMember) {
      throw new AppError('GAME_IN_PROGRESS', 'This village already has a game in progress.');
    }

    // Capacity is checked against APPROVED members only — a pile of
    // pending requests never blocks the lobby from filling with players
    // the host has actually accepted (see VillageDocument.pendingPlayerIds's
    // doc comment). The host is still free to deny the excess once over
    // capacity; this route doesn't pre-emptively reject a request just
    // because pending + approved together exceed maxPlayers.
    if (!alreadyMember && village.playerIds.length >= village.maxPlayers) {
      throw new AppError('VILLAGE_FULL', 'This village is already at capacity.');
    }

    // HOST APPROVAL GATE: a genuinely new player joining a still-open
    // LOBBY is held in pendingPlayerIds rather than admitted outright —
    // see VillageDocument.pendingPlayerIds's doc comment for why this is a
    // Mongo-persisted field (survives a page reload while waiting) rather
    // than purely a socket-session concept. An already-pending player
    // re-POSTing (e.g. a retried request) is idempotent, not re-queued.
    // The village's OWN HOST is always exempt — they're already a member
    // from village creation (`alreadyMember` covers them), so this branch
    // is unreachable for them regardless.
    if (!alreadyMember && !alreadyPending) {
      await villagesRepository.addPendingPlayer(code, playerId);
      res.status(200).json({
        code: village._id,
        name: village.name,
        status: 'PENDING' as const,
        playerCount: village.playerIds.length,
        maxPlayers: village.maxPlayers,
        minPlayers: village.minPlayers,
      });
      return;
    }

    const updated = await villagesRepository.findVillageByCode(code);
    if (!updated) {
      // Unreachable in practice — we just wrote to this exact document —
      // but treated as a real error rather than asserted away, in case a
      // concurrent deletion (village close) raced this request.
      throw new AppError('VILLAGE_NOT_FOUND', `No village found with code ${code}.`);
    }

    // Reached for: an existing member resuming (approved already, above),
    // or a still-pending player re-POSTing before the host has responded —
    // the latter reports PENDING again rather than falling through to the
    // approved-member response shape.
    res.status(200).json({
      code: updated._id,
      name: updated.name,
      status: alreadyMember ? updated.status : ('PENDING' as const),
      playerCount: updated.playerIds.length,
      maxPlayers: updated.maxPlayers,
      minPlayers: updated.minPlayers,
    });
  }),
);
