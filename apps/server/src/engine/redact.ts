// ---------------------------------------------------------------------------
// redactStateFor — the single security chokepoint between the server's
// private FullGameState and anything that reaches a client. Every socket
// emission of game state MUST go through this function; nothing else is
// allowed to serialize a FullGameState.
//
// DEFENSIVE-BY-CONSTRUCTION: this function builds the PlayerView field by
// field from scratch. It never spreads/copies FullGameState and then
// deletes or overwrites fields — a future field added to FullGameState
// (e.g. a new private-knowledge type) is therefore invisible to the
// recipient by default, and has to be deliberately added to `you` below to
// ever reach a client. The failure mode of "someone adds a field to
// FullGameState and forgets to redact it" is impossible here, by
// construction — it can only fail the other way (a client not seeing
// something it should), which is a bug you notice, not a leak you don't.
// ---------------------------------------------------------------------------

import type { FullGameState, PlayerId, PlayerView, PublicPlayer, You } from '@mafia/shared';

/** Builds the `you` block: private knowledge belonging only to `viewerId`.
 * `viewer.role` is legitimately absent in the LOBBY, before the host has
 * started the game and `assignRoles` has run — that's not an error case,
 * just a `you` block with no role-derived fields populated yet. A missing
 * `viewer` entry entirely (the id isn't a player in this game at all) IS a
 * caller bug, since every socket handler already checks membership via
 * `requirePlayerInSession` before ever reaching here — so that case still
 * throws loudly rather than silently returning a bogus view. */
function buildYou(state: FullGameState, viewerId: PlayerId): You {
  const viewer = state.players.find((p) => p.id === viewerId);
  if (!viewer) {
    throw new Error(`redactStateFor: viewer ${viewerId} is not a player in this game`);
  }

  const you: You = {
    playerId: viewer.id,
    role: viewer.role,
    hasActedThisPhase: hasActedThisPhase(state, viewer.id),
  };

  if (viewer.role === 'MAFIA') {
    you.mafiaTeammateIds = state.players
      .filter((p) => p.role === 'MAFIA' && p.id !== viewer.id)
      .map((p) => p.id);
  }

  if (viewer.role === 'DETECTIVE') {
    you.detectiveResults = state.nightActions
      .filter((a) => a.actorId === viewer.id && a.actorRole === 'DETECTIVE' && a.targetId !== undefined)
      .map((a) => {
        const target = state.players.find((p) => p.id === a.targetId);
        return {
          targetId: a.targetId as PlayerId,
          isMafia: target?.role === 'MAFIA',
          nightNumber: a.nightNumber,
        };
      });
  }

  if (viewer.role === 'MAFIA' && state.phase === 'NIGHT') {
    you.mafiaNightTargets = state.players
      .filter((p) => p.role === 'MAFIA')
      .map((teammate) => {
        const action = state.nightActions.find(
          (a) => a.actorId === teammate.id && a.actorRole === 'MAFIA' && a.nightNumber === state.roundNumber,
        );
        return { actorId: teammate.id, targetId: action?.targetId };
      });
  }

  if (viewer.role === 'DOCTOR') {
    you.lastProtectedPlayerId = lastNightsProtectionTarget(state, viewer.id);
  }

  return you;
}

/** The doctor's own protection target from the immediately preceding
 * night, if any — mirrors the exact rule `wasProtectedLastNight` enforces
 * in engine/nightActions.ts (only the round directly before the current
 * one counts, so a gap night resets the lockout). Kept here rather than
 * imported from nightActions.ts since that module's helper checks "was
 * THIS target protected", whereas the client needs "who DID the doctor
 * protect" to know which single tile to disable — different questions
 * over the same underlying rule. */
function lastNightsProtectionTarget(state: FullGameState, doctorId: PlayerId): PlayerId | undefined {
  const previousRound = state.roundNumber - 1;
  if (previousRound < 1) return undefined;
  const previousAction = state.nightActions.find(
    (a) => a.actorId === doctorId && a.actorRole === 'DOCTOR' && a.nightNumber === previousRound,
  );
  return previousAction?.targetId;
}

function hasActedThisPhase(state: FullGameState, playerId: PlayerId): boolean {
  if (state.phase === 'NIGHT') {
    return state.nightActions.some((a) => a.actorId === playerId && a.nightNumber === state.roundNumber);
  }
  if (state.phase === 'DAY_VOTE') {
    return state.votes.some((v) => v.voterId === playerId && v.dayNumber === state.roundNumber);
  }
  return false;
}

/** Builds one entry of the public roster: every field a client is allowed
 * to see about *any* player, self included, except the bare `role` field —
 * that only ever appears on `revealedRole` (once publicly revealed) or,
 * for the viewer's own role, inside `you`. */
function buildPublicPlayer(state: FullGameState, playerId: PlayerId): PublicPlayer {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`redactStateFor: player ${playerId} disappeared while building the public roster`);
  }
  return {
    id: player.id,
    name: player.name,
    status: player.status,
    connected: player.connected,
    isHost: player.isHost,
    isReady: player.isReady,
    revealedRole: player.revealedRole,
    joinedAt: player.joinedAt,
  };
}

/**
 * Which chat channels `viewerId` is entitled to see. LOBBY and DAY are
 * public to everyone in the village; MAFIA is restricted to living mafia
 * members (mafia who died lose access, same as anyone else); DEAD is
 * restricted to players who are currently dead, so the living can't
 * eavesdrop on the dead chat.
 */
function visibleChannelsFor(state: FullGameState, viewerId: PlayerId): ReadonlyArray<'LOBBY' | 'DAY' | 'MAFIA' | 'DEAD'> {
  const viewer = state.players.find((p) => p.id === viewerId);
  const channels: Array<'LOBBY' | 'DAY' | 'MAFIA' | 'DEAD'> = ['LOBBY', 'DAY'];
  if (viewer?.role === 'MAFIA' && viewer.status === 'ALIVE') {
    channels.push('MAFIA');
  }
  if (viewer?.status === 'DEAD') {
    channels.push('DEAD');
  }
  return channels;
}

/**
 * Projects the server's private `FullGameState` down to exactly what
 * `viewerId` is allowed to see. See the module header — this function is
 * the security boundary of the entire application and is written
 * defensively on purpose: every field of `PlayerView` is constructed from
 * an explicit, named source, never copied wholesale from `FullGameState`.
 */
export function redactStateFor(state: FullGameState, viewerId: PlayerId): PlayerView {
  const visibleChannels = new Set(visibleChannelsFor(state, viewerId));

  return {
    villageCode: state.villageCode,
    phase: state.phase,
    roundNumber: state.roundNumber,
    players: state.players.map((p) => buildPublicPlayer(state, p.id)),
    phaseTimer: state.phaseTimer,
    chatLog: state.chatLog.filter((m) => visibleChannels.has(m.channel)),
    votes: state.votes
      .filter((v) => v.dayNumber === state.roundNumber)
      .map((v) => ({ voterId: v.voterId, targetId: v.targetId, dayNumber: v.dayNumber, submittedAt: v.submittedAt })),
    endReason: state.endReason,
    winningTeam: state.winningTeam,
    you: buildYou(state, viewerId),
  };
}
