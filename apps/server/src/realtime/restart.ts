// ---------------------------------------------------------------------------
// Server restart recovery. Call `recoverInProgressGames(io)` once at boot,
// after the DB connection and collections are ready but before the HTTP
// server starts accepting traffic — see index.ts at the app root.
//
// THE RESUME-VS-ABANDON RULE
// ---------------------------------------------------------------------------
// A game is found IN_PROGRESS in Mongo at boot for exactly one reason: the
// process died (crash, deploy, OOM-kill) while it was running — a healthy
// shutdown always reaches GAME_OVER or explicitly abandons first (see
// gracefulShutdown below). For each such game:
//
//   RESUME if — and only if — its village is still found with status
//   'IN_GAME' in Mongo. The village record carries the player roster
//   (`playerIds`) and host id that a resumed in-memory GameSession needs
//   to reconstruct a `FullGameState` shell; without it there is no lobby
//   left to attach reconnecting sockets to, and no way to know who is
//   even still supposed to be in this game.
//
//   ABANDON in every other case: the village record is missing entirely (its
//   TTL index — see db/collections.ts — already reaped it, meaning it's
//   been untouched for 4+ hours, plenty long enough that resuming would
//   reunite nobody), or the village's status is anything other than
//   'IN_GAME' (it was explicitly closed, or never promoted past LOBBY,
//   which shouldn't happen for a game that has a GameDocument at all, but
//   is treated as "can't resume" rather than assumed impossible).
//
// A resumed game does NOT replay individual in-flight actions from the
// gameEvents log — only the checkpointed roster/phase/round from the
// GameDocument itself. Any action submitted after the last phase-boundary
// flush and before the crash is lost, by design: this is the exact,
// already-documented tradeoff in db/index.ts's hot-path boundary comment
// ("losing at most one in-progress phase's events if the process crashes
// mid-phase"). A resumed phase restarts at its beginning with a full fresh
// timer — nobody gets penalized with less time than everyone else because
// of when the crash happened, but nobody's already-submitted-this-phase
// action survives either. This is simpler and more honest than attempting
// a partial replay that could resurrect a stale, possibly-tampered-with
// action from before the crash.
// ---------------------------------------------------------------------------

import { brandFullGameState, nextApplicableNightSubPhase, type FullGameState, type Player } from '@mafia/shared';
import { gamesRepository, villagesRepository } from '../db';
import type { GameDocument } from '../db/types';
import { logger } from '../logger';
import { villageManager, type GameSession } from './VillageManager';
import { broadcastStateToVillage, type GameServer } from './emit';
import { startCurrentPhase } from './phaseLoop';
import { persistGameAbandoned } from './persistence';

/** Rebuilds a FullGameState shell for a resumed game. Night
 * actions/votes/chat are intentionally empty — see the module header:
 * nothing from the crashed phase survives, only the checkpointed roster
 * and phase/round. */
function reconstructState(game: GameDocument): FullGameState {
  const players: Player[] = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    status: p.status,
    connected: false, // nobody has an active socket yet at boot
    isHost: p.isHost,
    isReady: p.isReady,
    revealedRole: p.revealedRole,
    joinedAt: p.joinedAt,
  }));

  return brandFullGameState({
    villageCode: game.villageCode,
    phase: game.currentPhase,
    roundNumber: game.roundNumber,
    players,
    // A resumed NIGHT restarts its moderator sequence from the beginning
    // (matches the module header: nothing from the crashed phase's
    // in-flight actions survives, so there's nothing to resume mid-
    // sequence either) — first applicable role, same as a freshly started
    // NIGHT. Any other resumed phase has no sub-phase concept.
    nightSubPhase: game.currentPhase === 'NIGHT' ? nextApplicableNightSubPhase(players, undefined) : undefined,
    nightActions: [],
    votes: [],
    nominations: [],
    // A resumed DAY_VOTE has no surviving nomination history to recompute
    // a real shortlist from (same "nothing from the crashed phase
    // survives" rule as nightActions/votes above) — falls back to every
    // living player being a valid target, same as resolveNominations'
    // own empty-nominations fallback, rather than an empty shortlist that
    // would make every vote INVALID_TARGET.
    shortlistedIds: game.currentPhase === 'DAY_VOTE' ? players.filter((p) => p.status === 'ALIVE').map((p) => p.id) : [],
    chatLog: [],
    endReason: game.endReason,
    winningTeam: game.winningTeam,
  });
}

/**
 * Inspects every IN_PROGRESS game and either resumes it (rebuilding an
 * in-memory GameSession and restarting its phase timer) or marks it
 * ABANDONED, per the rule above. Safe to call exactly once at boot; not
 * idempotent against being called mid-run (it would re-resume already-
 * running sessions), which is why index.ts only calls it before `listen`.
 */
export async function recoverInProgressGames(io: GameServer): Promise<{ resumed: number; abandoned: number }> {
  const inProgressGames = await gamesRepository.findInProgressGames();
  let resumed = 0;
  let abandoned = 0;

  for (const game of inProgressGames) {
    const village = await villagesRepository.findVillageByCode(game.villageCode);

    if (!village || village.status !== 'IN_GAME') {
      await persistGameAbandoned(game._id);
      abandoned += 1;
      logger.warn('abandoned game on restart recovery', {
        gameId: game._id,
        villageCode: game.villageCode,
        reason: !village ? 'village not found' : `village status is ${village.status}`,
      });
      continue;
    }

    const state = reconstructState(game);
    const session: GameSession = {
      villageCode: game.villageCode,
      gameId: game._id,
      state,
      sockets: new Map(),
      seenActionIds: new Set(),
      roleSeed: Date.now() ^ Math.floor(Math.random() * 0xffffffff),
      pendingEvents: [],
      // A resumed game restarts its current phase at full default
      // duration (see the module header above) — any host-configured
      // durations from before the crash aren't persisted anywhere
      // (they're a lobby-only, in-memory setting), so there's nothing to
      // restore here even in principle.
      phaseDurationOverridesMs: {},
      // A resumed game is always past LOBBY (see the status filter above)
      // — join-approval is a lobby-only concept, so there's nothing to
      // restore here either, same rationale as phaseDurationOverridesMs.
      pendingRequests: new Map(),
    };
    villageManager.create(session);

    // Restart the current phase from scratch with a full-duration timer —
    // see the module header for why no partial time is carried over. A
    // resumed phase auto-starts its timer immediately, unlike a normal
    // human-moderator transition (see phaseLoop.ts's module header) —
    // there's no host client sitting in this recovery path to explicitly
    // press "start", and leaving a resumed game's timer un-started forever
    // (with no one around to ever start it) would be strictly worse than
    // resuming automatically at the cost of losing pause/reveal state,
    // which restart.ts already documents as not preserved across a crash.
    startCurrentPhase(io, session, Date.now());
    broadcastStateToVillage(io, session);

    resumed += 1;
    logger.info('resumed game on restart recovery', {
      gameId: game._id,
      villageCode: game.villageCode,
      phase: game.currentPhase,
    });
  }

  logger.info('restart recovery complete', { resumed, abandoned });
  return { resumed, abandoned };
}

/**
 * Marks every currently-active in-memory session's game ABANDONED and
 * clears its scheduled deadline. Call on a graceful shutdown (SIGTERM),
 * BEFORE the process exits, so a healthy shutdown never leaves a
 * misleadingly-IN_PROGRESS game document for the next boot's
 * `recoverInProgressGames` to have to guess about — a clean shutdown
 * always abandons explicitly rather than relying on the crash-recovery
 * path to sort it out later.
 */
export async function abandonAllActiveGames(): Promise<void> {
  const sessions = [...villageManager.all()];
  await Promise.all(
    sessions
      .filter((s): s is GameSession & { gameId: string } => Boolean(s.gameId))
      .map((s) => persistGameAbandoned(s.gameId)),
  );
  for (const session of sessions) {
    villageManager.delete(session.villageCode);
  }
}
