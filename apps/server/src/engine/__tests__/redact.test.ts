import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { brandFullGameState, type FullGameState, type Role } from '@mafia/shared';
import { redactStateFor } from '../redact';
import { buildState, pid } from './helpers';

const ROLES: Role[] = ['VILLAGER', 'MAFIA', 'DETECTIVE', 'DOCTOR', 'JESTER'];

describe('redactStateFor', () => {
  it('never leaks another player\'s role', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    const otherPlayers = view.players.filter((p) => p.id !== pid('villager1'));
    for (const p of otherPlayers) {
      expect((p as { role?: unknown }).role).toBeUndefined();
      expect(p.revealedRole).toBeUndefined();
    }
  });

  it('sends the public nomination tally and shortlist identically to every viewer, living or dead', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'ghost', name: 'G', role: 'VILLAGER', status: 'DEAD' },
      ],
      nominations: [{ nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }],
      shortlistedIds: [pid('v2')],
    });

    const livingView = redactStateFor(state, pid('v1'));
    const deadView = redactStateFor(state, pid('ghost'));

    for (const view of [livingView, deadView]) {
      expect(view.nominations).toEqual([{ nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }]);
      expect(view.shortlistedIds).toEqual([pid('v2')]);
    }
  });

  it('filters the nomination tally to the current round only', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 2,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }, // stale prior round
        { nominatorId: pid('v2'), targetId: pid('v1'), dayNumber: 2, submittedAt: 2 },
      ],
    });

    const view = redactStateFor(state, pid('v1'));
    expect(view.nominations).toEqual([{ nominatorId: pid('v2'), targetId: pid('v1'), dayNumber: 2, submittedAt: 2 }]);
  });

  it('includes the viewer\'s own role only in `you`, never in the players array', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.role).toBe('MAFIA');
    const selfEntry = view.players.find((p) => p.id === pid('mafia1'));
    expect((selfEntry as { role?: unknown } | undefined)?.role).toBeUndefined();
  });

  it('flags the host/moderator\'s own view with you.isModerator, and gives them no role', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });

    const hostView = redactStateFor(state, pid('host'));
    expect(hostView.you.isModerator).toBe(true);
    expect(hostView.you.role).toBeUndefined();

    const playerView = redactStateFor(state, pid('v1'));
    expect(playerView.you.isModerator).toBe(false);
  });

  it('omits the host/moderator entirely from every other viewer\'s roster', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'DETECTIVE' },
      ],
    });

    const playerView = redactStateFor(state, pid('v1'));
    expect(playerView.players.some((p) => p.id === pid('host'))).toBe(false);
    // The rest of the roster is untouched — only the host's row is hidden.
    expect(playerView.players.map((p) => p.id).sort()).toEqual([pid('v1'), pid('v2')].sort());
  });

  it('still shows the host their own row, and shows the host EVERY row', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });

    const hostView = redactStateFor(state, pid('host'));
    expect(hostView.players.map((p) => p.id).sort()).toEqual([pid('host'), pid('v1')].sort());
  });

  it('reveals a role once it has been publicly revealed (revealedRole)', () => {
    const state = brandFullGameState({
      villageCode: 'ABCD' as FullGameState['villageCode'],
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: pid('mafia1'), name: 'M', role: 'MAFIA', revealedRole: 'MAFIA', status: 'DEAD', connected: true, isHost: false, isReady: true, joinedAt: 0 },
        { id: pid('villager1'), name: 'V', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: false, isReady: true, joinedAt: 0 },
      ],
      nightActions: [],
      votes: [],
      nominations: [],
      shortlistedIds: [],
      chatLog: [],
    });

    const view = redactStateFor(state, pid('villager1'));
    const dead = view.players.find((p) => p.id === pid('mafia1'));
    expect(dead?.revealedRole).toBe('MAFIA');
  });

  describe('pendingNarration reveal gate (human moderator model)', () => {
    /** A resolution that already killed 'victim' (status/revealedRole
     * already applied, exactly as phaseLoop.ts's advancePhase does) but is
     * still sitting in pendingNarration, unrevealed. */
    function buildPendingDeathState(): FullGameState {
      return brandFullGameState({
        villageCode: 'ABCD' as FullGameState['villageCode'],
        phase: 'DAY_DISCUSSION',
        roundNumber: 1,
        players: [
          { id: pid('host1'), name: 'Host', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: true, isReady: true, joinedAt: 0 },
          { id: pid('victim'), name: 'Victim', role: 'MAFIA', revealedRole: 'MAFIA', status: 'DEAD', connected: true, isHost: false, isReady: true, joinedAt: 0 },
          { id: pid('bystander'), name: 'Bystander', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: false, isReady: true, joinedAt: 0 },
        ],
        nightActions: [],
        votes: [],
        nominations: [],
        shortlistedIds: [],
        chatLog: [],
        pendingNarration: {
          forPhase: 'NIGHT',
          text: 'Victim was found dead.',
          outcome: { died: [{ playerId: pid('victim'), role: 'MAFIA' }], wasTie: false },
        },
      });
    }

    it('masks a third party\'s view of a not-yet-revealed death: status back to ALIVE, revealedRole stripped', () => {
      const state = buildPendingDeathState();
      const view = redactStateFor(state, pid('bystander'));
      const victim = view.players.find((p) => p.id === pid('victim'));
      expect(victim?.status).toBe('ALIVE');
      expect(victim?.revealedRole).toBeUndefined();
    });

    it('hides pendingNarration entirely from a non-host viewer', () => {
      const state = buildPendingDeathState();
      const view = redactStateFor(state, pid('bystander'));
      expect(view.pendingNarration).toBeUndefined();
    });

    it('shows the victim their OWN death immediately, even though others don\'t see it yet', () => {
      const state = buildPendingDeathState();
      const view = redactStateFor(state, pid('victim'));
      const self = view.players.find((p) => p.id === pid('victim'));
      expect(self?.status).toBe('DEAD');
      expect(self?.revealedRole).toBe('MAFIA');
    });

    it('gives the host the real, unmasked roster and the pendingNarration itself', () => {
      const state = buildPendingDeathState();
      const view = redactStateFor(state, pid('host1'));
      const victim = view.players.find((p) => p.id === pid('victim'));
      expect(victim?.status).toBe('DEAD');
      expect(victim?.revealedRole).toBe('MAFIA');
      expect(view.pendingNarration?.text).toBe('Victim was found dead.');
    });

    it('leaves an already-revealed (prior round) death visible — only the CURRENT pendingNarration is masked', () => {
      const state = brandFullGameState({
        villageCode: 'ABCD' as FullGameState['villageCode'],
        phase: 'DAY_VOTE',
        roundNumber: 2,
        players: [
          { id: pid('host1'), name: 'Host', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: true, isReady: true, joinedAt: 0 },
          // Died and was already revealed last round — not in this round's pendingNarration.
          { id: pid('oldVictim'), name: 'Old', role: 'DOCTOR', revealedRole: 'DOCTOR', status: 'DEAD', connected: true, isHost: false, isReady: true, joinedAt: 0 },
          { id: pid('newVictim'), name: 'New', role: 'MAFIA', revealedRole: 'MAFIA', status: 'DEAD', connected: true, isHost: false, isReady: true, joinedAt: 0 },
          { id: pid('bystander'), name: 'Bystander', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: false, isReady: true, joinedAt: 0 },
        ],
        nightActions: [],
        votes: [],
        nominations: [],
        shortlistedIds: [],
        chatLog: [],
        pendingNarration: {
          forPhase: 'DAY_VOTE',
          text: 'New was voted out.',
          outcome: { died: [{ playerId: pid('newVictim'), role: 'MAFIA' }], wasTie: false },
        },
      });

      const view = redactStateFor(state, pid('bystander'));
      const oldVictim = view.players.find((p) => p.id === pid('oldVictim'));
      const newVictim = view.players.find((p) => p.id === pid('newVictim'));
      expect(oldVictim?.status).toBe('DEAD'); // prior reveal stays visible
      expect(oldVictim?.revealedRole).toBe('DOCTOR');
      expect(newVictim?.status).toBe('ALIVE'); // current one is masked
      expect(newVictim?.revealedRole).toBeUndefined();
    });
  });

  it('gives the mafia player their living teammates\' ids', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA' },
        { id: 'mafia2', name: 'M2', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaTeammateIds).toEqual([pid('mafia2')]);
  });

  it('does not populate mafiaTeammateIds for a non-mafia viewer', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.mafiaTeammateIds).toBeUndefined();
  });

  it('gives the detective their own investigation history, target roles included only as isMafia', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('detective1'), actorRole: 'DETECTIVE', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 10 },
      ],
    });

    const view = redactStateFor(state, pid('detective1'));
    expect(view.you.detectiveResults).toEqual([{ targetId: pid('mafia1'), isMafia: true, nightNumber: 1 }]);
  });

  it('filters mafia chat out of a non-mafia viewer\'s chat log', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      chatLog: [
        { id: 'c1', channel: 'MAFIA', senderId: pid('mafia1'), senderName: 'M', body: 'secret plan', sentAt: 1 },
        { id: 'c2', channel: 'DAY', senderId: pid('villager1'), senderName: 'V', body: 'hello', sentAt: 2 },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    expect(view.chatLog.map((m) => m.id)).toEqual(['c2']);
  });

  it('lets a living mafia member see the mafia chat channel', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      chatLog: [
        { id: 'c1', channel: 'MAFIA', senderId: pid('mafia1'), senderName: 'M', body: 'secret plan', sentAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.chatLog.map((m) => m.id)).toEqual(['c1']);
  });

  it('gives a mafia viewer a live tally of every teammate\'s current-round target during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 2,
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA' },
        { id: 'mafia2', name: 'M2', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 2, submittedAt: 1 },
        // mafia2 hasn't acted yet this round.
        { id: 'a0', actorId: pid('mafia2'), actorRole: 'MAFIA', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 1 }, // prior round, must not count
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaNightTargets).toEqual(
      expect.arrayContaining([
        { actorId: pid('mafia1'), targetId: pid('villager1') },
        { actorId: pid('mafia2'), targetId: undefined },
      ]),
    );
    expect(view.you.mafiaNightTargets).toHaveLength(2);
  });

  it('does not populate mafiaNightTargets outside of NIGHT', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'mafia1', name: 'M', role: 'MAFIA' }],
    });
    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaNightTargets).toBeUndefined();
  });

  it('does not populate mafiaNightTargets for a non-mafia viewer', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });
    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.mafiaNightTargets).toBeUndefined();
  });

  it('gives a dead viewer a count-only night-activity signal during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 3,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'doctor1', name: 'D', role: 'DOCTOR' },
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
        { id: 'ghost', name: 'G', role: 'VILLAGER', status: 'DEAD' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('doctor1'), nightNumber: 3, submittedAt: 1 },
        // Same actor resubmitting (see nightActions.ts's "last submission
        // wins" rule) must not inflate the count past 1 distinct actor.
        { id: 'a2', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('detective1'), nightNumber: 3, submittedAt: 2 },
        // A prior round's action must not count toward THIS round's tally.
        { id: 'a0', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('mafia1'), nightNumber: 2, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('ghost'));
    // 1 distinct actor (mafia1) out of 3 living roles that act at night
    // (mafia1, doctor1, detective1).
    expect(view.you.deadNightProgress).toEqual({ actedCount: 1, totalActingRoles: 3 });
  });

  it('does not populate deadNightProgress outside of NIGHT', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'ghost', name: 'G', role: 'VILLAGER', status: 'DEAD' }],
    });
    const view = redactStateFor(state, pid('ghost'));
    expect(view.you.deadNightProgress).toBeUndefined();
  });

  it('does not populate deadNightProgress for a LIVING viewer, even during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });
    for (const viewerId of ['mafia1', 'villager1'] as const) {
      const view = redactStateFor(state, pid(viewerId));
      expect(view.you.deadNightProgress).toBeUndefined();
    }
  });

  it('never leaks an actorId or targetId from nightActions into a dead viewer\'s PlayerView', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
        { id: 'ghost', name: 'G', role: 'VILLAGER', status: 'DEAD' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('ghost'));
    const serialized = JSON.stringify(view);
    // The only legitimate way an id can appear is as a player's own `id`
    // field (roster rows) — neither the mafia actor's id nor the villager
    // target's id should appear anywhere else (e.g. inside `you`) beyond
    // that. deadNightProgress itself must carry no id fields at all.
    expect(view.you.deadNightProgress).toEqual({ actedCount: 1, totalActingRoles: 1 });
    expect(Object.keys(view.you.deadNightProgress ?? {})).toEqual(['actedCount', 'totalActingRoles']);
    expect(serialized).not.toContain('"targetId"');
  });

  it('gives the doctor lastProtectedPlayerId when they protected someone the immediately preceding night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 2,
      players: [
        { id: 'doctor1', name: 'Doc', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 1, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('doctor1'));
    expect(view.you.lastProtectedPlayerId).toBe(pid('villager1'));
  });

  it('leaves lastProtectedPlayerId undefined on the first night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [{ id: 'doctor1', name: 'Doc', role: 'DOCTOR' }],
    });
    const view = redactStateFor(state, pid('doctor1'));
    expect(view.you.lastProtectedPlayerId).toBeUndefined();
  });

  it('leaves lastProtectedPlayerId undefined when the doctor protected someone two nights ago but someone else last night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 3,
      players: [
        { id: 'doctor1', name: 'Doc', role: 'DOCTOR' },
        { id: 'v1', name: 'V1', role: 'VILLAGER' },
        { id: 'v2', name: 'V2', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
        { id: 'a2', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('v2'), nightNumber: 2, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('doctor1'));
    // Round 3's lockout is keyed on round 2's target (v2), not round 1's (v1).
    expect(view.you.lastProtectedPlayerId).toBe(pid('v2'));
  });

  it('does not populate lastProtectedPlayerId for a non-doctor viewer', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [{ id: 'villager1', name: 'V', role: 'VILLAGER' }],
    });
    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.lastProtectedPlayerId).toBeUndefined();
  });

  describe('moderatorNightView (host-only night dashboard)', () => {
    const nightPlayers = [
      { id: 'host', name: 'Host', isHost: true },
      { id: 'mafia1', name: 'Mara', role: 'MAFIA' as const },
      { id: 'doc1', name: 'Dana', role: 'DOCTOR' as const },
      { id: 'det1', name: 'Del', role: 'DETECTIVE' as const },
      { id: 'v1', name: 'Vic', role: 'VILLAGER' as const },
    ];

    it('is populated only for the host, never for any other viewer', () => {
      const state = buildState({ phase: 'NIGHT', roundNumber: 1, players: nightPlayers });
      expect(redactStateFor(state, pid('host')).you.moderatorNightView).toBeDefined();
      for (const id of ['mafia1', 'doc1', 'det1', 'v1']) {
        expect(redactStateFor(state, pid(id)).you.moderatorNightView).toBeUndefined();
      }
    });

    it('reports live acted-status and target for each acting role in the current round', () => {
      const state = buildState({
        phase: 'NIGHT',
        roundNumber: 1,
        players: nightPlayers,
        nightActions: [
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a2', actorId: pid('det1'), actorRole: 'DETECTIVE', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 2 },
          // doctor hasn't acted yet
        ],
      });

      const roles = redactStateFor(state, pid('host')).you.moderatorNightView?.currentRound?.roles ?? [];
      const byRole = Object.fromEntries(roles.map((r) => [r.role, r]));
      expect(byRole.MAFIA).toMatchObject({ submitted: true, targetName: 'Vic', actorNames: ['Mara'] });
      expect(byRole.DETECTIVE).toMatchObject({ submitted: true, targetName: 'Mara' });
      expect(byRole.DOCTOR).toMatchObject({ submitted: false, targetName: undefined, actorNames: [] });
    });

    it('marks a role with no living holder as not in play, and uses last-submission-wins for MAFIA', () => {
      const state = buildState({
        phase: 'NIGHT',
        roundNumber: 1,
        players: [
          { id: 'host', name: 'Host', isHost: true },
          { id: 'mafia1', name: 'Mara', role: 'MAFIA' },
          { id: 'v1', name: 'Vic', role: 'VILLAGER' },
          { id: 'v2', name: 'Val', role: 'VILLAGER' },
        ],
        nightActions: [
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a2', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v2'), nightNumber: 1, submittedAt: 2 },
        ],
      });

      const roles = redactStateFor(state, pid('host')).you.moderatorNightView?.currentRound?.roles ?? [];
      const byRole = Object.fromEntries(roles.map((r) => [r.role, r]));
      expect(byRole.MAFIA).toMatchObject({ submitted: true, targetName: 'Val' }); // last wins
      expect(byRole.DOCTOR).toMatchObject({ hasLivingHolder: false });
      expect(byRole.DETECTIVE).toMatchObject({ hasLivingHolder: false });
    });

    it('has no currentRound outside NIGHT, but still reports resolved-night history', () => {
      const state = buildState({
        phase: 'DAY_DISCUSSION',
        roundNumber: 1,
        players: [
          { id: 'host', name: 'Host', isHost: true },
          { id: 'mafia1', name: 'Mara', role: 'MAFIA' },
          { id: 'doc1', name: 'Dana', role: 'DOCTOR' },
          { id: 'v1', name: 'Vic', role: 'VILLAGER', status: 'DEAD' },
        ],
        nightActions: [
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a2', actorId: pid('doc1'), actorRole: 'DOCTOR', targetId: pid('doc1'), nightNumber: 1, submittedAt: 2 },
        ],
      });

      const mnv = redactStateFor(state, pid('host')).you.moderatorNightView;
      expect(mnv?.currentRound).toBeUndefined();
      expect(mnv?.history).toHaveLength(1);
      expect(mnv?.history[0]).toMatchObject({
        nightNumber: 1,
        mafiaTargetName: 'Vic',
        doctorTargetName: 'Dana',
        saveLanded: false,
        diedName: 'Vic',
        diedRole: 'VILLAGER',
      });
    });

    it('history recap: save landed => no death; save missed => death', () => {
      const base = [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'mafia1', name: 'Mara', role: 'MAFIA' as const },
        { id: 'doc1', name: 'Dana', role: 'DOCTOR' as const },
        { id: 'v1', name: 'Vic', role: 'VILLAGER' as const },
      ];

      const saved = buildState({
        phase: 'DAY_DISCUSSION',
        roundNumber: 1,
        players: base,
        nightActions: [
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a2', actorId: pid('doc1'), actorRole: 'DOCTOR', targetId: pid('v1'), nightNumber: 1, submittedAt: 2 },
        ],
      });
      const savedEntry = redactStateFor(saved, pid('host')).you.moderatorNightView?.history[0];
      expect(savedEntry).toMatchObject({ saveLanded: true, diedId: undefined, diedName: undefined });

      const missed = buildState({
        phase: 'DAY_DISCUSSION',
        roundNumber: 1,
        players: base,
        nightActions: [
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a2', actorId: pid('doc1'), actorRole: 'DOCTOR', targetId: pid('doc1'), nightNumber: 1, submittedAt: 2 },
        ],
      });
      const missedEntry = redactStateFor(missed, pid('host')).you.moderatorNightView?.history[0];
      expect(missedEntry).toMatchObject({ saveLanded: false, diedName: 'Vic', diedRole: 'VILLAGER' });
    });

    it('history recap: a repeat doctor protection does not count as a save', () => {
      const state = buildState({
        phase: 'DAY_DISCUSSION',
        roundNumber: 2,
        players: [
          { id: 'host', name: 'Host', isHost: true },
          { id: 'mafia1', name: 'Mara', role: 'MAFIA' },
          { id: 'doc1', name: 'Dana', role: 'DOCTOR' },
          { id: 'v1', name: 'Vic', role: 'VILLAGER' },
        ],
        nightActions: [
          { id: 'a0', actorId: pid('doc1'), actorRole: 'DOCTOR', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
          { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 2, submittedAt: 2 },
          { id: 'a2', actorId: pid('doc1'), actorRole: 'DOCTOR', targetId: pid('v1'), nightNumber: 2, submittedAt: 3 },
        ],
      });

      const history = redactStateFor(state, pid('host')).you.moderatorNightView?.history ?? [];
      const night2 = history.find((h) => h.nightNumber === 2);
      expect(night2).toMatchObject({ saveLanded: false, diedName: 'Vic' });
    });

    it('history recap: detective result carried as detectiveFoundMafia', () => {
      const state = buildState({
        phase: 'DAY_DISCUSSION',
        roundNumber: 1,
        players: [
          { id: 'host', name: 'Host', isHost: true },
          { id: 'mafia1', name: 'Mara', role: 'MAFIA' },
          { id: 'det1', name: 'Del', role: 'DETECTIVE' },
        ],
        nightActions: [
          { id: 'a1', actorId: pid('det1'), actorRole: 'DETECTIVE', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 1 },
        ],
      });

      const entry = redactStateFor(state, pid('host')).you.moderatorNightView?.history[0];
      expect(entry).toMatchObject({ detectiveTargetName: 'Mara', detectiveFoundMafia: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Property-based test: for any randomly generated FullGameState and any
// player in it, the resulting PlayerView — after JSON serialization, as it
// would actually cross the wire — never contains a role string belonging to
// a *different* player. This is the strongest guarantee this function
// makes; the property test tries to break it with structures the example
// tests above wouldn't think to construct.
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom(...ROLES);

const playerArb = fc.record({
  idSuffix: fc.integer({ min: 0, max: 999 }),
  role: roleArb,
  status: fc.constantFrom<'ALIVE' | 'DEAD'>('ALIVE', 'DEAD'),
  reveal: fc.boolean(),
});

const gameArb = fc
  .array(playerArb, { minLength: 1, maxLength: 12 })
  .map((players) =>
    players.map((p, index) => ({ ...p, idSuffix: index })), // guarantee unique ids
  )
  .chain((players) =>
    fc.record({
      players: fc.constant(players),
      viewerIndex: fc.integer({ min: 0, max: players.length - 1 }),
    }),
  );

describe('redactStateFor property: no cross-player role leakage', () => {
  it('the serialized PlayerView never contains another player\'s role string', () => {
    fc.assert(
      fc.property(gameArb, ({ players, viewerIndex }) => {
        const state = brandFullGameState({
          villageCode: 'ABCD' as FullGameState['villageCode'],
          phase: 'DAY_DISCUSSION',
          roundNumber: 1,
          players: players.map((p) => ({
            id: pid(`p${p.idSuffix}`),
            name: `Player ${p.idSuffix}`,
            role: p.role,
            revealedRole: p.reveal ? p.role : undefined,
            status: p.status,
            connected: true,
            isHost: p.idSuffix === 0,
            isReady: true,
            joinedAt: 0,
          })),
          nightActions: [],
          votes: [],
          nominations: [],
          shortlistedIds: [],
          chatLog: [],
        });

        const viewer = players[viewerIndex];
        if (!viewer) return; // shouldn't happen given the generator's bounds

        const viewerId = pid(`p${viewer.idSuffix}`);
        const view = redactStateFor(state, viewerId);

        // Round-trip through JSON, exactly like a socket.io emit would, so
        // the property covers what actually reaches the wire, not just the
        // in-memory object shape.
        const serialized = JSON.parse(JSON.stringify(view)) as typeof view;

        // Player index 0 is always the host/moderator in this fixture (see
        // `isHost: p.idSuffix === 0` below) — invisible to every OTHER
        // viewer's roster entirely (see redact.ts's visiblePlayerIds), not
        // merely masked field-by-field like a pending death. `viewerIsHost`
        // mirrors that same exception: the host's own view still sees
        // everyone, themselves included.
        const viewerIsHost = viewer.idSuffix === 0;

        for (const other of players) {
          if (other.idSuffix === viewer.idSuffix) continue; // self is allowed via `you`
          const otherId = `p${other.idSuffix}`;
          const otherIsHost = other.idSuffix === 0;
          const publicEntry = serialized.players.find((p) => p.id === otherId);

          if (otherIsHost && !viewerIsHost) {
            // The host is invisible to a non-host viewer's roster — no
            // entry at all, not even a masked one.
            expect(publicEntry).toBeUndefined();
            continue;
          }

          expect(publicEntry).toBeDefined();

          // `role` must never appear on another player's public entry at all.
          expect(Object.prototype.hasOwnProperty.call(publicEntry, 'role')).toBe(false);

          // `revealedRole`, when present, is allowed to equal the real role
          // — that's the whole point of a public reveal — but it must be
          // absent when the fixture never revealed this player.
          if (!other.reveal) {
            expect(publicEntry?.revealedRole).toBeUndefined();
          }
        }

        // The viewer's own role must appear exactly where expected: in
        // `you.role`, and nowhere on their own public roster entry. (This
        // fixture assigns every generated player a `role`, host included —
        // it's a generic role-leakage property test, not a test of the
        // real game's "the host never has a role" invariant, which is
        // covered separately in the example-based tests above.)
        expect(serialized.you.role).toBe(viewer.role);
        const selfEntry = serialized.players.find((p) => p.id === `p${viewer.idSuffix}`);
        expect(Object.prototype.hasOwnProperty.call(selfEntry, 'role')).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
