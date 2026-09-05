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

import type {
  FullGameState,
  ModeratorNightHistoryEntry,
  ModeratorNightRoleState,
  ModeratorNightView,
  PlayerId,
  PlayerView,
  PublicPlayer,
  You,
} from '@mafia/shared';
import { NIGHT_ACTING_ROLES } from './nightActions';

/** Builds the `you` block: private knowledge belonging only to `viewerId`.
 * `viewer.role` is legitimately absent in the LOBBY, before the host has
 * started the game and `assignRoles` has run — that's not an error case,
 * just a `you` block with no role-derived fields populated yet. It is ALSO
 * permanently absent for the host/moderator (see Player.isHost's doc
 * comment) — `you.isModerator` is the explicit signal a client should use
 * to tell these two "no role" cases apart, rather than inferring from
 * `role === undefined` alone (ambiguous: "not assigned yet" vs "will never
 * have one"). A missing `viewer` entry entirely (the id isn't a player in
 * this game at all) IS a caller bug, since every socket handler already
 * checks membership via `requirePlayerInSession` before ever reaching here
 * — so that case still throws loudly rather than silently returning a
 * bogus view. */
function buildYou(state: FullGameState, viewerId: PlayerId): You {
  const viewer = state.players.find((p) => p.id === viewerId);
  if (!viewer) {
    throw new Error(`redactStateFor: viewer ${viewerId} is not a player in this game`);
  }

  const you: You = {
    playerId: viewer.id,
    role: viewer.role,
    isModerator: viewer.isHost,
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

  if (viewer.status === 'DEAD' && state.phase === 'NIGHT') {
    you.deadNightProgress = buildDeadNightProgress(state);
  }

  // Host-only night dashboard — carries the exact actor/target identities
  // the rest of this function is careful NOT to hand any other viewer. Same
  // gate as `pendingNarration` (see redactStateFor below): `viewer.isHost`,
  // nothing else. A non-host `you` never has this field at all.
  if (viewer.isHost) {
    you.moderatorNightView = buildModeratorNightView(state);
  }

  return you;
}

const MODERATOR_NIGHT_ROLES = ['MAFIA', 'DETECTIVE', 'DOCTOR'] as const;

/** Builds the host-only night dashboard: live per-role acted-status +
 * target for the current night (only while `phase === 'NIGHT'`), plus an
 * oldest-first recap of every night that has already resolved. All of it
 * is derived from `state.nightActions` + `state.players` — the same
 * sources `resolveNight` reads — so the recap's save-vs-kill verdict
 * always matches what actually happened. */
function buildModeratorNightView(state: FullGameState): ModeratorNightView {
  const nameOf = (id: PlayerId | undefined): string | undefined =>
    id === undefined ? undefined : state.players.find((p) => p.id === id)?.name;

  let currentRound: ModeratorNightView['currentRound'];
  if (state.phase === 'NIGHT') {
    const roundActions = state.nightActions.filter((a) => a.nightNumber === state.roundNumber);
    const roles: ModeratorNightRoleState[] = MODERATOR_NIGHT_ROLES.map((role) => {
      const forRole = roundActions.filter((a) => a.actorRole === role);
      // MAFIA: last submission wins for the kill target (mirrors
      // resolveNight's `.at(-1)`); DETECTIVE/DOCTOR are single-shot.
      const effective = role === 'MAFIA' ? forRole.at(-1) : forRole[0];
      const actorNames = [
        ...new Set(
          forRole
            .map((a) => nameOf(a.actorId))
            .filter((n): n is string => n !== undefined),
        ),
      ];
      return {
        role,
        hasLivingHolder: state.players.some(
          (p) => p.status === 'ALIVE' && p.role === role,
        ),
        submitted: forRole.length > 0,
        actorNames,
        targetId: effective?.targetId,
        targetName: nameOf(effective?.targetId),
      };
    });
    currentRound = { nightNumber: state.roundNumber, roles };
  }

  // Every night number that has at least one recorded action AND is
  // strictly before the current round (a night with actions but == the
  // current round is still in progress, reported via `currentRound`).
  const resolvedNights = [
    ...new Set(
      state.nightActions
        .map((a) => a.nightNumber)
        .filter((n) => state.phase !== 'NIGHT' || n < state.roundNumber),
    ),
  ].sort((a, b) => a - b);

  const history: ModeratorNightHistoryEntry[] = resolvedNights.map((nightNumber) => {
    const actions = state.nightActions.filter((a) => a.nightNumber === nightNumber);
    const mafiaAction = actions.filter((a) => a.actorRole === 'MAFIA').at(-1);
    const doctorAction = actions.find((a) => a.actorRole === 'DOCTOR');
    const detectiveAction = actions.find((a) => a.actorRole === 'DETECTIVE');

    // Mirror resolveNight's no-repeat-protection rule: a doctor protecting
    // the same target as the immediately preceding night is a no-op save.
    const doctorRepeated =
      doctorAction?.targetId !== undefined &&
      state.nightActions.some(
        (a) =>
          a.actorRole === 'DOCTOR' &&
          a.nightNumber === nightNumber - 1 &&
          a.targetId === doctorAction.targetId,
      );
    const effectiveSaveTargetId = doctorRepeated ? undefined : doctorAction?.targetId;

    const killTargetId = mafiaAction?.targetId;
    const saveLanded =
      killTargetId !== undefined && killTargetId === effectiveSaveTargetId;
    const diedId = killTargetId !== undefined && !saveLanded ? killTargetId : undefined;
    const victim = diedId !== undefined ? state.players.find((p) => p.id === diedId) : undefined;

    const detectiveTarget =
      detectiveAction?.targetId !== undefined
        ? state.players.find((p) => p.id === detectiveAction.targetId)
        : undefined;

    return {
      nightNumber,
      mafiaTargetId: killTargetId,
      mafiaTargetName: nameOf(killTargetId),
      doctorTargetId: doctorAction?.targetId,
      doctorTargetName: nameOf(doctorAction?.targetId),
      saveLanded,
      diedId,
      diedName: victim?.name,
      diedRole: victim?.role,
      detectiveTargetId: detectiveAction?.targetId,
      detectiveTargetName: nameOf(detectiveAction?.targetId),
      detectiveFoundMafia:
        detectiveAction?.targetId !== undefined ? detectiveTarget?.role === 'MAFIA' : undefined,
    };
  });

  return { currentRound, history };
}

/** Count-only night-activity signal for a dead spectator — see
 * `deadNightProgress`'s doc comment on `YouSchema` for why this is
 * deliberately identity-free. `actedCount` counts DISTINCT actors who have
 * submitted this round (a MAFIA member revising their target — see
 * nightActions.ts's "last submission wins" rule — must not inflate the
 * count past the number of people who've actually acted). `totalActingRoles`
 * counts LIVING players currently holding an acting role, mirroring
 * `nextApplicableNightSubPhase`'s own "skip roles nobody living holds"
 * logic in @mafia/shared, so the denominator never overstates how many
 * people could possibly act this round. */
function buildDeadNightProgress(state: FullGameState): NonNullable<You['deadNightProgress']> {
  const actedCount = new Set(
    state.nightActions.filter((a) => a.nightNumber === state.roundNumber).map((a) => a.actorId),
  ).size;
  const totalActingRoles = state.players.filter(
    (p) => p.status === 'ALIVE' && p.role && NIGHT_ACTING_ROLES.includes(p.role),
  ).length;
  return { actedCount, totalActingRoles };
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
  if (state.phase === 'DAY_DISCUSSION') {
    return state.nominations.some((n) => n.nominatorId === playerId && n.dayNumber === state.roundNumber);
  }
  if (state.phase === 'DAY_VOTE') {
    return state.votes.some((v) => v.voterId === playerId && v.dayNumber === state.roundNumber);
  }
  return false;
}

/**
 * Which player ids died in the resolution `state.pendingNarration` is
 * still holding back from the table — i.e. whose `status`/`revealedRole`
 * `buildPublicPlayer` must mask for every OTHER viewer until the host
 * calls `revealNarration`. Empty whenever there's no pending narration
 * (the normal case), so `buildPublicPlayer` below is a no-op fast path
 * outside the brief resolved-but-not-yet-revealed window.
 */
function pendingDeathIds(state: FullGameState): ReadonlySet<PlayerId> {
  if (!state.pendingNarration) return new Set();
  return new Set(state.pendingNarration.outcome.died.map((d) => d.playerId));
}

/**
 * Builds one entry of the public roster: every field a client is allowed
 * to see about *any* player, self included, except the bare `role` field —
 * that only ever appears on `revealedRole` (once publicly revealed) or,
 * for the viewer's own role, inside `you`.
 *
 * MODERATOR REVEAL GATE: while a resolution is sitting in
 * `pendingNarration` (see phaseLoop.ts's module header — the host hasn't
 * called `revealNarration` yet), a player who died in THAT resolution must
 * not show up as dead to anyone else's roster — otherwise the "reveal" the
 * host controls would be theater: everyone would already see the death in
 * their player list the instant it happened, narration or not. Three
 * exceptions, all deliberate:
 *   - The player's own row, on their own PlayerView (`playerId ===
 *     viewerId`) — masking someone's death from THEMSELVES would leave
 *     their own client thinking they can still act/vote/talk in the living
 *     channels, an actively broken UI state, not just a spoiled surprise.
 *   - The host's view of anyone — the host needs the real roster to write
 *     an accurate narration and to see who they're about to reveal.
 *   - A death from any PRIOR, already-revealed resolution — only ids in
 *     the CURRENT `pendingNarration.died` are masked; old deaths remain
 *     visible exactly as before this feature existed.
 */
function buildPublicPlayer(state: FullGameState, playerId: PlayerId, viewerId: PlayerId, viewerIsHost: boolean): PublicPlayer {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`redactStateFor: player ${playerId} disappeared while building the public roster`);
  }

  const mustMask = !viewerIsHost && playerId !== viewerId && pendingDeathIds(state).has(playerId);

  return {
    id: player.id,
    name: player.name,
    status: mustMask ? 'ALIVE' : player.status,
    connected: player.connected,
    isHost: player.isHost,
    isReady: player.isReady,
    revealedRole: mustMask ? undefined : player.revealedRole,
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
 * Which player rows `viewerId` is entitled to see at all — distinct from
 * `buildPublicPlayer`'s per-field masking, which redacts what's visible
 * ABOUT a row that's already going out. The host/moderator is invisible to
 * everyone else's roster entirely: not shown dimmed/disabled, not counted
 * in a total, not present as a row a non-host client could ever inspect —
 * so there is no player object anywhere in a non-host's PlayerView a curious
 * client could use to nominate/vote/target them, even by fishing an id out
 * of network traffic. The two exceptions are symmetric with
 * `buildPublicPlayer`'s own death-reveal exceptions: the host's OWN row on
 * their OWN view (they need to see themselves — e.g. their tile in any
 * roster-derived UI), and every row on the host's OWN view (moderating
 * requires seeing everyone, including — trivially — themselves).
 */
function visiblePlayerIds(state: FullGameState, viewerId: PlayerId, viewerIsHost: boolean): ReadonlySet<PlayerId> {
  if (viewerIsHost) return new Set(state.players.map((p) => p.id));
  return new Set(state.players.filter((p) => !p.isHost || p.id === viewerId).map((p) => p.id));
}

/**
 * Projects the server's private `FullGameState` down to exactly what
 * `viewerId` is allowed to see. See the module header — this function is
 * the security boundary of the entire application and is written
 * defensively on purpose: every field of `PlayerView` is constructed from
 * an explicit, named source, never copied wholesale from `FullGameState`.
 */
export function redactStateFor(state: FullGameState, viewerId: PlayerId, gameId?: string): PlayerView {
  const viewer = state.players.find((p) => p.id === viewerId);
  const viewerIsHost = viewer?.isHost ?? false;
  const visibleChannels = new Set(visibleChannelsFor(state, viewerId));
  const visiblePlayers = visiblePlayerIds(state, viewerId, viewerIsHost);

  return {
    villageCode: state.villageCode,
    gameId,
    phase: state.phase,
    roundNumber: state.roundNumber,
    // The host/moderator's row is omitted entirely from every OTHER
    // viewer's roster — see visiblePlayerIds's doc comment. This is a
    // stricter guarantee than "excluded from targeting": the row simply
    // doesn't exist in a non-host client's PlayerView, so there's nothing
    // to nominate/vote/target even for a client that ignored the UI's own
    // filtering and tried to act on a stale/guessed id.
    players: state.players
      .filter((p) => visiblePlayers.has(p.id))
      .map((p) => buildPublicPlayer(state, p.id, viewerId, viewerIsHost)),
    phaseTimer: state.phaseTimer,
    // Passed through unredacted for every viewer, same as `phase` itself —
    // a role NAME ("it's the detective's turn") isn't tied to a player id,
    // so it doesn't reveal WHO holds that role, only that the moderator-
    // driven night sequence has reached that step. See
    // NightSubPhaseSchema's doc comment in @mafia/shared.
    nightSubPhase: state.nightSubPhase,
    // Only the host sees the pending narration before it's revealed — that's
    // the whole point of the reveal gate (see buildPublicPlayer's doc
    // comment above): a non-host player getting the suggested text/outcome
    // straight from state would know exactly what happened before the host
    // ever says a word, same leak as an unmasked roster would be.
    pendingNarration: viewerIsHost ? state.pendingNarration : undefined,
    chatLog: state.chatLog.filter((m) => visibleChannels.has(m.channel)),
    votes: state.votes
      .filter((v) => v.dayNumber === state.roundNumber)
      .map((v) => ({ voterId: v.voterId, targetId: v.targetId, dayNumber: v.dayNumber, submittedAt: v.submittedAt })),
    // Public nomination tally — unconditional for every viewer, living or
    // dead, unlike the mafia's private night tally: nominating is public
    // the instant it's cast, same as a vote already is, so there is no
    // per-viewer redaction to apply here. Untouched by the pendingNarration
    // death-reveal gate (see buildPublicPlayer's doc comment above) since
    // nominations never change a player's status/revealedRole.
    nominations: state.nominations
      .filter((n) => n.dayNumber === state.roundNumber)
      .map((n) => ({ nominatorId: n.nominatorId, targetId: n.targetId, dayNumber: n.dayNumber, submittedAt: n.submittedAt })),
    shortlistedIds: state.shortlistedIds,
    endReason: state.endReason,
    winningTeam: state.winningTeam,
    you: buildYou(state, viewerId),
  };
}
