'use client';

// ---------------------------------------------------------------------------
// VotingPhase — the player grid with live vote-avatar stacks, plus an
// equally-prominent explicit Abstain option. Vote changes are allowed
// right up until the phase ends (this is a real engine rule — castVote
// replaces the voter's prior vote for the round, see engine/voting.ts —
// not a client-side convenience), so unlike the night phase's TargetGrid,
// there's no "locked once confirmed" state: the Confirm button always
// submits whatever's currently staged, and can be pressed again after a
// change of mind.
//
// Tap-to-select then Confirm is still the interaction (no accidental
// one-tap commit, matching NightPhase/TargetGrid's convention) — staging a
// tap only changes what's highlighted; nothing reaches the server until
// Confirm.
// ---------------------------------------------------------------------------

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerId, PlayerView, PublicPlayer } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { CountdownRing } from '@/components/CountdownRing';
import { DaySkyBackdrop } from '@/components/DaySkyBackdrop';
import { HostPhaseControls } from '@/components/HostPhaseControls';
import { IdentityBadge } from '@/components/IdentityBadge';
import { HowToPlayButton, HowToPlayModal } from '@/components/HowToPlayModal';
import { PhaseBanner } from '@/components/PhaseBanner';
import { PlayerTile } from '@/components/PlayerTile';
import { useToast } from '@/components/Toast';
import { useSocket } from '@/lib/socket-context';
import { vibrate } from '@/lib/useFeedback';
import { useStagedChoice } from '@/lib/useStagedChoice';
import { useThemeSync } from '@/lib/useThemeSync';
import { GameLog, GameLogButton } from './GameLog';
import { useGameLog } from '@/lib/useGameLog';
import { useUnreadGameLog } from '@/lib/useUnreadGameLog';
import { VoteAvatarStack } from './VoteAvatarStack';

export interface VotingPhaseProps {
  view: PlayerView;
  lastPhaseChange: Parameters<typeof useGameLog>[1];
}

const ABSTAIN_SENTINEL = '__ABSTAIN__';

export function VotingPhase({ view, lastPhaseChange }: VotingPhaseProps) {
  useThemeSync('day');
  const { emit, status } = useSocket();
  const toast = useToast();
  const [logOpen, setLogOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const gameLog = useGameLog(view.villageCode, lastPhaseChange);
  const [logUnread, markLogRead] = useUnreadGameLog(gameLog.length);

  const self = view.players.find((p) => p.id === view.you.playerId);
  const alive = self?.status === 'ALIVE';

  const currentRoundVotes = useMemo(
    () => view.votes.filter((v) => v.dayNumber === view.roundNumber),
    [view.votes, view.roundNumber],
  );
  const myExistingVote = currentRoundVotes.find((v) => v.voterId === view.you.playerId);

  // A CONFIRMED vote is already durable without any help — it's right
  // there in `view.votes` (public, unlike a night action's secret
  // target), so a reload naturally restores it via `myExistingVote`. The
  // gap `useStagedChoice` closes here is narrower than in NightPhase: only
  // a tapped-but-never-confirmed choice, which `view.votes` has no record
  // of at all. See useStagedChoice's module header for the full contract;
  // `ABSTAIN_SENTINEL` round-trips through storage as an ordinary string,
  // same as any target id.
  const [stagedFromStorage, setStagedInStorage, clearStagedInStorage] = useStagedChoice(
    view.villageCode,
    view.phase,
    view.roundNumber,
  );
  const [staged, setStagedState] = useState<string | null>(
    myExistingVote ? (myExistingVote.targetId ?? ABSTAIN_SENTINEL) : stagedFromStorage,
  );
  const [submitting, setSubmitting] = useState(false);

  // useCallback, not a plain function: this needs to be referentially
  // STABLE across renders (see toggleStagedTarget below, and PlayerTile's
  // module header on why memo() is worthless if the callback it's handed
  // is a new function identity every render). Both setters it calls are
  // themselves stable (setStagedState is a React state setter;
  // setStagedInStorage is useStagedChoice's own useCallback), and neither
  // is read here — only invoked with the passed `value` — so this has no
  // real dependencies.
  const setStaged = useCallback(
    (value: string | null) => {
      setStagedState(value);
      setStagedInStorage(value);
    },
    [setStagedInStorage],
  );

  // Mirrors `staged` synchronously so toggleStagedTarget (below) can read
  // the CURRENT value without needing `staged` in its own dependency
  // array — a ref read doesn't require useCallback to rebuild the
  // function, which is exactly what keeps that callback's identity stable
  // across every selection change (a plain closure over `staged` would
  // need a fresh function — and therefore a new prop reference handed to
  // every PlayerTile — on every single toggle).
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  // Stable across renders regardless of what's currently staged — this,
  // plus PlayerTile's memo(), is the actual fix being measured in the
  // Prompt 14 re-render audit: one shared callback per grid instead of a
  // fresh closure per tile per render.
  const toggleStagedTarget = useCallback(
    (playerId: string) => {
      const next = stagedRef.current === playerId ? null : playerId;
      setStaged(next);
    },
    [setStaged],
  );

  // Reset staged choice at the start of a new round, and re-sync it if the
  // server's own record of this player's vote changes underneath us (e.g.
  // a resync after reconnect landing mid-vote). The server's own record
  // always wins over anything locally staged once it exists.
  useEffect(() => {
    setStagedState(myExistingVote ? (myExistingVote.targetId ?? ABSTAIN_SENTINEL) : stagedFromStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.roundNumber, myExistingVote?.targetId]);

  // Confirmation haptic — same "server echoed it back, and it wasn't there
  // a render ago" treatment as DiscussionPhase's mirror-image effect (see
  // that file's comment for the full rationale, including why a vote CHANGE
  // doesn't re-buzz, only its first appearance each round).
  const hadVoteRef = useRef(Boolean(myExistingVote));
  useEffect(() => {
    const hasNow = Boolean(myExistingVote);
    if (hasNow && !hadVoteRef.current) vibrate(15);
    hadVoteRef.current = hasNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myExistingVote?.targetId, view.roundNumber]);

  const votesByTarget = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const vote of currentRoundVotes) {
      if (!vote.targetId) continue;
      const list = map.get(vote.targetId) ?? [];
      list.push(vote.voterId);
      map.set(vote.targetId, list);
    }
    return map;
  }, [currentRoundVotes]);

  const abstainVoterIds = currentRoundVotes.filter((v) => !v.targetId).map((v) => v.voterId);

  // Once the server's own record of this vote exists, the locally-staged
  // copy has served its purpose (see useStagedChoice's module header —
  // the server record is the actual source of truth) and would otherwise
  // just sit in storage as stale leftover for the rest of the round.
  useEffect(() => {
    if (myExistingVote) clearStagedInStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myExistingVote?.targetId]);

  async function handleConfirm() {
    if (!staged || submitting) return;
    setSubmitting(true);
    const targetId = staged === ABSTAIN_SENTINEL ? undefined : (staged as PlayerId);
    const result = await emit.castVote({ villageCode: view.villageCode, targetId });
    setSubmitting(false);
    if (!result.ok) {
      toast.show(result.error.message, { tone: 'danger' });
    } else {
      toast.show(staged === ABSTAIN_SENTINEL ? 'You abstained.' : 'Your vote has been cast.', { tone: 'success' });
    }
  }

  const phaseTimer = view.phaseTimer;
  const hasChanges = staged !== (myExistingVote ? (myExistingVote.targetId ?? ABSTAIN_SENTINEL) : null);

  // A player is a valid vote target only if they were shortlisted during
  // DAY_DISCUSSION's nomination round — see engine/voting.ts's castVote.
  // `shortlistedIds` is guaranteed non-empty by the time DAY_VOTE is
  // reachable (resolveNominations falls back to every living player if
  // nobody nominated anyone — see engine/nominations.ts), so the
  // `.length === 0` branch below is defensive only, matching the same
  // belt-and-braces guard on the server side.
  const isShortlisted = (playerId: string) => view.shortlistedIds.length === 0 || view.shortlistedIds.includes(playerId as PlayerId);
  // The host/moderator is never shortlisted (see engine/nominations.ts's
  // resolveNominations, which excludes them from the open-vote fallback
  // too) — excluded here so their permanent absence from the shortlist
  // never falsely triggers the "open vote" banner for an otherwise
  // perfectly normal, real shortlist.
  const wasOpenVote =
    view.shortlistedIds.length > 0 &&
    view.players.every((p) => p.isHost || p.status !== 'ALIVE' || isShortlisted(p.id));

  return (
    <div className="relative flex h-full flex-col">
      <DaySkyBackdrop />

      <div className="relative z-10 flex flex-col gap-3 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <PhaseBanner tone="vote" label="Time to vote" narration="Choose wisely — a tie saves everyone." />
          <div className="flex items-center gap-2">
            <ConnectionIndicator status={status} />
            <IdentityBadge name={self?.name ?? ''} role={view.you.role} isModerator={view.you.isModerator} />
            <HowToPlayButton onClick={() => setHowToPlayOpen(true)} />
            <GameLogButton onClick={() => { setLogOpen(true); markLogRead(); }} hasUnread={logUnread} />
          </div>
        </div>
        {phaseTimer && (
          <div className="flex justify-center">
            <CountdownRing endsAt={phaseTimer.endsAt} durationMs={phaseTimer.durationMs} />
          </div>
        )}

        <HostPhaseControls view={view} />
      </div>

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 pb-4">
        {view.you.isModerator ? (
          // The host/moderator never votes — see Player.isHost's doc
          // comment in @mafia/shared/entities.ts — so they get the same
          // "nothing of your own to do here" treatment as NightPhase.tsx,
          // not the voting grid (which castVote would reject them from
          // anyway) or the dead player's "watching from beyond" copy,
          // which doesn't apply to them either.
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span aria-hidden="true" className="text-4xl">
              🗳️
            </span>
            <p className="text-base-content/60">You&apos;re moderating — use the controls above to run the vote.</p>
          </div>
        ) : (
          <div className="m-auto flex w-full max-w-2xl flex-col gap-4">
            {!alive && (
              <p className="rounded-xl bg-base-content/5 px-3 py-2 text-center text-sm text-base-content/60">
                <span aria-hidden="true">👻</span> You&apos;re watching this vote from beyond — the tally below is live.
              </p>
            )}
            {wasOpenVote && (
              <p className="rounded-xl bg-base-content/5 px-3 py-2 text-center text-sm text-base-content/60">
                No one was nominated — the vote is open to everyone.
              </p>
            )}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))' }}>
              {/* The host/moderator is never a valid vote target — see
               * Player.isHost's doc comment in @mafia/shared/entities.ts —
               * excluded from the grid entirely, same treatment as
               * NightPhase.tsx's TargetGrid and DiscussionPhase.tsx. A dead
               * viewer sees this SAME live grid+tally, read-only — see the
               * `alive &&` guard below, which is the only thing gating
               * interactivity; a dead viewer's `isTargetable` is always
               * false, which PlayerTile already renders as a non-tappable
               * tile (see PlayerTile's own `interactive` logic), so no
               * separate "dead" rendering branch is needed here at all. */}
              {view.players.filter((p) => !p.isHost).map((p) => {
                const isTargetable = alive && p.status === 'ALIVE' && p.id !== view.you.playerId && isShortlisted(p.id);
                const voters = votesByTarget.get(p.id) ?? [];
                return (
                  <div key={p.id} className="flex flex-col items-center gap-1.5">
                    <VoteTargetTile
                      player={p}
                      isSelf={p.id === view.you.playerId}
                      isTargetable={isTargetable}
                      selected={staged === p.id}
                      onToggle={toggleStagedTarget}
                    />
                    <VoteAvatarStack voterIds={voters} players={view.players} />
                  </div>
                );
              })}
            </div>

            {/* Abstain: an explicit, equally prominent option — same size
             * and interaction pattern as a player tile, not a small link
             * tucked below the grid. Still shown (with its live count) to a
             * dead spectator, just non-interactive — same treatment as the
             * grid above. */}
            <button
              type="button"
              disabled={!alive}
              onClick={() => setStaged(staged === ABSTAIN_SENTINEL ? null : ABSTAIN_SENTINEL)}
              aria-pressed={staged === ABSTAIN_SENTINEL}
              className={[
                'flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold transition-colors motion-reduce:transition-none',
                'disabled:opacity-60',
                staged === ABSTAIN_SENTINEL
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-base-content/10 bg-elevated text-base-content/70 active:bg-base-content/5',
              ].join(' ')}
            >
              <span aria-hidden="true">🤷</span>
              Abstain
              {abstainVoterIds.length > 0 && (
                <span className="text-sm font-normal text-base-content/50">({abstainVoterIds.length})</span>
              )}
            </button>
          </div>
        )}
      </div>

      {alive && !view.you.isModerator && (
        <div className="relative z-10">
          <ActionBar
            caption={
              staged
                ? hasChanges
                  ? 'Tap Confirm to lock in your choice.'
                  : 'Your vote has been recorded. You can still change it.'
                : 'Select a player or Abstain, then confirm.'
            }
          >
            <ActionButton onClick={handleConfirm} disabled={!staged || !hasChanges} loading={submitting}>
              Confirm
            </ActionButton>
          </ActionBar>
        </div>
      )}

      <GameLog open={logOpen} onClose={() => setLogOpen(false)} entries={gameLog} players={view.players} />
      <HowToPlayModal open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} myRole={view.you.role} />
    </div>
  );
}

interface VoteTargetTileProps {
  player: PublicPlayer;
  isSelf: boolean;
  isTargetable: boolean;
  selected: boolean;
  /** ONE shared, stable callback from the parent grid (see
   * toggleStagedTarget above) — not one closure per tile. Each tile below
   * wraps it in its OWN useCallback, scoped to its own (stable) playerId,
   * so PlayerTile's memo() sees a stable `onSelect` reference across
   * renders where this tile's own props haven't changed, even while
   * OTHER tiles in the grid are re-rendering for their own reasons. */
  onToggle: (playerId: PlayerId) => void;
}

function VoteTargetTileImpl({ player, isSelf, isTargetable, selected, onToggle }: VoteTargetTileProps) {
  const handleSelect = useCallback(() => {
    onToggle(player.id);
  }, [onToggle, player.id]);

  return (
    <PlayerTile
      playerId={player.id}
      name={player.name}
      alive={player.status === 'ALIVE'}
      isSelf={isSelf}
      connected={player.connected}
      selected={selected}
      disabled={!isTargetable}
      onSelect={isTargetable ? handleSelect : undefined}
    />
  );
}

/** Thin memoized wrapper between the grid's per-player map and PlayerTile
 * — see this file's module header and PlayerTile's own for the full
 * rationale. Bails out of re-rendering (and re-rendering its child
 * PlayerTile) whenever none of the fields THIS tile actually cares about
 * changed — see the Prompt 14 re-render audit for the measured
 * before/after numbers.
 *
 * CUSTOM comparator, not memo()'s default shallow-props check: `player`
 * (a `PublicPlayer`) is NOT referentially stable across `stateUpdate`s —
 * `redactStateFor` (server/engine/redact.ts) rebuilds every player's
 * object from scratch on every single redaction call, by design (see its
 * own module header on why it's written that defensively). A default
 * shallow comparison would see a "different" `player` object on every
 * broadcast regardless of whether THIS player's own fields changed,
 * which would silently defeat memoization for exactly the high-frequency
 * "everyone's vote change re-broadcasts everyone's state" case this
 * audit exists to fix. Comparing the actual fields this component reads
 * (id/name/status/connected) is what makes the memoization real instead
 * of a no-op. */
const VoteTargetTile = memo(VoteTargetTileImpl, (prev, next) => {
  return (
    prev.player.id === next.player.id &&
    prev.player.name === next.player.name &&
    prev.player.status === next.player.status &&
    prev.player.connected === next.player.connected &&
    prev.isSelf === next.isSelf &&
    prev.isTargetable === next.isTargetable &&
    prev.selected === next.selected &&
    prev.onToggle === next.onToggle
  );
});
