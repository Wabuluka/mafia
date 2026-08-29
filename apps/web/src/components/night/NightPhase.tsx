'use client';

// ---------------------------------------------------------------------------
// NightPhase — the night-phase screen. This is where redaction is most
// visible in the UI, so read this before changing anything here.
//
// STRUCTURAL PARITY, ON PURPOSE: every role renders through the exact same
// shell (NightSkyBackdrop -> PhaseBanner -> CountdownRing -> ONE content
// card in the same position with the same padding). A villager's content
// card is a waiting message; an acting role's content card is a
// TargetGrid. Same card, same size class, same position in the layout —
// deliberately, so a player glancing at a neighbor's screen sees "a phone
// showing a dark screen with a card on it" in every case, never a shape
// that gives away "this person has something to do." The ACTUAL data
// difference (what's inside the card) is real; the SHAPE of the screen
// around it is identical. Never add a role-specific top-level layout
// change here — extend the shared shell instead.
//
// OPTIMISTIC UI: staging a target (tap) is always local-only — see
// TargetGrid's own header comment. Pressing Confirm immediately reflects
// the submission as "sent" (locks the grid, shows a pending state) before
// the server acknowledges; if the ack comes back `ok: false`, the staged
// selection and lock are rolled back and the rejection reason is shown as
// a toast, so the player can immediately try again rather than being
// stuck looking submitted while nothing actually happened server-side.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PhaseChangedPayload, PlayerId, PlayerView } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { CountdownRing } from '@/components/CountdownRing';
import { DetectiveResultCard } from '@/components/DetectiveResultCard';
import { HostPhaseControls } from '@/components/HostPhaseControls';
import { IdentityBadge } from '@/components/IdentityBadge';
import { HowToPlayButton, HowToPlayModal } from '@/components/HowToPlayModal';
import { MafiaChatPanel } from '@/components/MafiaChatPanel';
import { MafiaTally } from '@/components/MafiaTally';
import { NightSkyBackdrop } from '@/components/NightSkyBackdrop';
import { PhaseBanner } from '@/components/PhaseBanner';
import { TargetGrid, type TargetGridPlayer } from '@/components/TargetGrid';
import { useToast } from '@/components/Toast';
import { useSocket } from '@/lib/socket-context';
import { vibrate } from '@/lib/useFeedback';
import { useStagedChoice } from '@/lib/useStagedChoice';
import { useThemeSync } from '@/lib/useThemeSync';
import { useGameLog } from '@/lib/useGameLog';
import { useUnreadGameLog } from '@/lib/useUnreadGameLog';
import { GameLog, GameLogButton } from '@/components/day/GameLog';

export interface NightPhaseProps {
  view: PlayerView;
  /** See DiscussionPhase.tsx / VotingPhase.tsx — the same persistent,
   * one-tap game log the day screens expose, so a player who refreshed
   * (or whose phone locked) overnight and landed back on THIS screen can
   * still see what happened in the reveal they may have missed. */
  lastPhaseChange: PhaseChangedPayload | null;
}

interface BuildTargetGridPlayersOptions {
  accentTeammateIds?: Set<string>;
  cornerLabelFor?: (id: string) => string | undefined;
  disabledReasonFor?: (id: string) => string | undefined;
}

function buildTargetGridPlayers(view: PlayerView, options: BuildTargetGridPlayersOptions = {}): TargetGridPlayer[] {
  const { accentTeammateIds, cornerLabelFor, disabledReasonFor } = options;
  // The host/moderator is never a valid night-action target — see
  // Player.isHost's doc comment in @mafia/shared/entities.ts — so they're
  // excluded from every acting role's grid entirely, rather than shown
  // disabled like a dead player. A dead player being shown-but-disabled
  // communicates "they used to matter here"; the moderator never did.
  return view.players
    .filter((p) => !p.isHost)
    .map((p) => ({
      ...p,
      isSelf: p.id === view.you.playerId,
      accent: accentTeammateIds?.has(p.id) ? 'mafia' : null,
      cornerLabel: cornerLabelFor?.(p.id),
      disabledReason: disabledReasonFor?.(p.id),
    }));
}

export function NightPhase({ view, lastPhaseChange }: NightPhaseProps) {
  useThemeSync('mafia');
  const { emit, status } = useSocket();
  const toast = useToast();
  const [logOpen, setLogOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const gameLog = useGameLog(view.villageCode, lastPhaseChange);
  const [logUnread, markLogRead] = useUnreadGameLog(gameLog.length);

  // localStorage-backed, not plain useState: a force-quit between tapping
  // a target and tapping Confirm — or between tapping Confirm and the ack
  // coming back — previously lost the player's choice with no trace; on
  // relaunch the grid was simply blank again. Restoring `stagedTargetId`
  // from storage brings the player back to exactly what they'd selected,
  // pre-highlighted, so a re-tap of Confirm is a single tap, not a
  // from-scratch decision. This deliberately does NOT auto-submit on
  // restore — only an explicit Confirm tap ever calls
  // emit.submitNightAction, same as any other render of this screen — so
  // a merely-staged (never-confirmed) choice can never silently submit
  // itself just because the tab happened to reload. `locked` below still
  // comes from the SERVER's `hasActedThisPhase`, which is the only source
  // of truth for whether a submission actually landed — see
  // useStagedChoice's module header.
  const [stagedTargetId, setStagedTargetId, clearStaged] = useStagedChoice<PlayerId>(
    view.villageCode,
    view.phase,
    view.roundNumber,
  );
  const [submitting, setSubmitting] = useState(false);
  // Locked once a submission is confirmed and NOT rejected — the whole
  // grid disables so the player can't accidentally submit twice; only a
  // fresh round (roundNumber change) or a rejection unlocks it again.
  const [locked, setLocked] = useState(view.you.hasActedThisPhase);

  // Tracks the PREVIOUS hasActedThisPhase value across renders, purely so
  // the vibrate effect below can tell "just landed" apart from "was already
  // recorded when this screen mounted" (a reconnect/resync landing mid-phase
  // with an action already on file shouldn't buzz — nothing just happened).
  const wasActedRef = useRef(view.you.hasActedThisPhase);

  // hasActedThisPhase flips server-side once an action lands — treat that
  // as the ground truth for "locked", overriding local optimistic state
  // (covers a reconnect/resync landing mid-phase with an action already
  // recorded from before the drop). The server having recorded it is also
  // exactly when the locally-staged copy is no longer needed — see
  // useStagedChoice's module header on why clearing happens here, keyed
  // off server confirmation, rather than merely a submit ack returning ok.
  useEffect(() => {
    setLocked(view.you.hasActedThisPhase);
    if (view.you.hasActedThisPhase) {
      setSubmitting(false);
      clearStaged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.you.hasActedThisPhase, view.roundNumber]);

  // Confirmation haptic — fires only on the actual false->true transition,
  // never on mount/resync already-true, and never on an optimistic tap or a
  // rejected/rolled-back submission (both of those only ever set local
  // state, never this server-sourced field). See useFeedback's module
  // header on why this isn't gated by prefers-reduced-motion.
  useEffect(() => {
    if (view.you.hasActedThisPhase && !wasActedRef.current) {
      vibrate(15);
    }
    wasActedRef.current = view.you.hasActedThisPhase;
  }, [view.you.hasActedThisPhase]);

  async function handleConfirm() {
    if (!stagedTargetId || locked || submitting) return;

    const previousLocked = locked;
    setSubmitting(true);
    setLocked(true); // optimistic: lock immediately so a double-tap can't double-submit

    const result = await emit.submitNightAction({ villageCode: view.villageCode, targetId: stagedTargetId });

    setSubmitting(false);

    if (!result.ok) {
      // Rollback: unlock and keep the staged target selected so the
      // player can immediately see what was rejected and retry or change it.
      setLocked(previousLocked);
      toast.show(result.error.message, { tone: 'danger' });
    } else {
      toast.show('Your choice has been made.', { tone: 'success' });
      // Not cleared here — the effect above clears it once
      // `hasActedThisPhase` reflects the SERVER's record, which is the
      // actual source of truth (see useStagedChoice's module header).
    }
  }

  const role = view.you.role;
  const self = view.players.find((p) => p.id === view.you.playerId);
  const alive = self?.status === 'ALIVE';

  // Under the moderator-driven night flow (see @mafia/shared's
  // NightSubPhaseSchema), only the role currently "on the clock" may
  // submit — the server enforces this (WRONG_SUB_PHASE), this just keeps
  // the UI from inviting a tap that would only ever be rejected.
  // `nightSubPhase` is undefined for the brief window before the very
  // first NIGHT is initialized, or once the game has left NIGHT entirely
  // — both cases are effectively "not your turn" for every acting role.
  const isMyTurn = role !== undefined && view.nightSubPhase === role;

  const phaseTimer = view.phaseTimer;

  return (
    <div className="relative flex h-full flex-col">
      <NightSkyBackdrop />

      <div className="relative z-10 flex flex-col gap-4 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <PhaseBanner
            tone="night"
            label="The town is asleep"
            narration={view.you.isModerator ? 'Run the night — no action of your own tonight.' : roleNarration(role, alive)}
          />
          <div className="flex items-center gap-2">
            <ConnectionIndicator status={status} />
            <IdentityBadge name={self?.name ?? ''} role={role} isModerator={view.you.isModerator} />
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

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
        {/* The one content card every role renders, in the same position —
         * see the module header. Its CONTENTS differ by role/alive-state;
         * its presence, size, and placement never do. */}
        <div className="flex min-h-[16rem] flex-col gap-4 rounded-2xl bg-elevated/40 p-4">
          {view.you.isModerator ? (
            <ModeratorNightContent />
          ) : !alive ? (
            <DeadNightContent view={view} />
          ) : role === 'MAFIA' ? (
            <MafiaNightContent
              view={view}
              stagedTargetId={stagedTargetId}
              onStage={setStagedTargetId}
              locked={locked}
              isMyTurn={isMyTurn}
            />
          ) : role === 'DETECTIVE' ? (
            <DetectiveNightContent
              view={view}
              stagedTargetId={stagedTargetId}
              onStage={setStagedTargetId}
              locked={locked}
              isMyTurn={isMyTurn}
            />
          ) : role === 'DOCTOR' ? (
            <DoctorNightContent
              view={view}
              stagedTargetId={stagedTargetId}
              onStage={setStagedTargetId}
              locked={locked}
              isMyTurn={isMyTurn}
            />
          ) : (
            <WaitingNightContent />
          )}
        </div>
      </div>

      {alive && (role === 'MAFIA' || role === 'DETECTIVE' || role === 'DOCTOR') && (
        <div className="relative z-10">
          <ActionBar
            caption={
              locked
                ? 'Your choice has been made. Waiting for the night to end…'
                : !isMyTurn
                  ? "It isn't your turn yet — the moderator will call on you."
                  : stagedTargetId
                    ? 'Tap Confirm to lock in your choice.'
                    : 'Select a player, then confirm.'
            }
          >
            <ActionButton onClick={handleConfirm} disabled={!stagedTargetId || locked || !isMyTurn} loading={submitting}>
              Confirm
            </ActionButton>
          </ActionBar>
        </div>
      )}

      <GameLog open={logOpen} onClose={() => setLogOpen(false)} entries={gameLog} players={view.players} />
      <HowToPlayModal open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} myRole={role} />
    </div>
  );
}

function roleNarration(role: string | undefined, alive: boolean): string {
  if (!alive) return 'You are no longer among the living, but you may watch.';
  switch (role) {
    case 'MAFIA':
      return 'Choose who your family will silence tonight.';
    case 'DETECTIVE':
      return 'Choose someone to investigate.';
    case 'DOCTOR':
      return 'Choose someone to protect from harm.';
    default:
      return 'Everyone is asleep. Something is happening in the dark.';
  }
}

/** The host/moderator's content — same card shape as every other branch
 * (see the module header on why that parity matters), but distinct copy
 * from WaitingNightContent below: a moderator isn't "waiting" the way a
 * villager is (nothing will ever be asked of them), and HostPhaseControls
 * is already rendered above with their actual job for this phase — a
 * second "nothing to do" message here would just be confusing/redundant
 * next to those controls. */
function ModeratorNightContent() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span aria-hidden="true" className="text-4xl">
        🌙
      </span>
      <p className="text-base-content/60">You&apos;re moderating — use the controls above to run the night.</p>
    </div>
  );
}

/** The villager (and any other non-acting, living role's) content —
 * structurally the SAME card shape as every acting role's grid, just with
 * a waiting message instead of a grid. See the module header for why this
 * parity matters. */
function WaitingNightContent() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span aria-hidden="true" className="text-4xl">
        😴
      </span>
      <p className="text-base-content/60">You have nothing to do tonight.</p>
      <p className="text-sm text-base-content/40">Try to get some sleep.</p>
    </div>
  );
}

function DeadNightContent({ view }: { view: PlayerView }) {
  const progress = view.you.deadNightProgress;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span aria-hidden="true" className="text-4xl">
        👻
      </span>
      <p className="text-base-content/60">You are watching from beyond.</p>
      {/* Activity-only signal — see YouSchema.deadNightProgress's doc
       * comment: a count, never who's doing what to whom. Just enough to
       * tell a dead spectator the phase isn't frozen. */}
      {progress && (
        <p className="text-sm text-base-content/40">
          {progress.actedCount} of {progress.totalActingRoles} {progress.totalActingRoles === 1 ? 'role has' : 'roles have'} acted.
        </p>
      )}
      {view.chatLog.some((m) => m.channel === 'DEAD') && (
        <p className="text-sm text-base-content/40">Check the dead chat to talk with other spirits.</p>
      )}
    </div>
  );
}

interface RoleNightContentProps {
  view: PlayerView;
  stagedTargetId: PlayerId | null;
  onStage: (id: PlayerId | null) => void;
  locked: boolean;
  /** Whether the moderator-driven night sequence has currently reached
   * THIS role — see @mafia/shared's NightSubPhaseSchema. The grid (and,
   * for mafia, the chat input) stays visible but disabled while it isn't
   * this role's turn yet, rather than disappearing, so a player always
   * knows what they're waiting for. */
  isMyTurn: boolean;
}

function MafiaNightContent({ view, stagedTargetId, onStage, locked, isMyTurn }: RoleNightContentProps) {
  const { emit } = useSocket();
  const teammateIds = new Set(view.you.mafiaTeammateIds ?? []);
  const players = buildTargetGridPlayers(view, { accentTeammateIds: teammateIds });
  const mafiaMessages = view.chatLog.filter((m: ChatMessage) => m.channel === 'MAFIA');
  // A lone mafia has no one to coordinate with — the family chat is just
  // dead UI, so don't render it at all in that case.
  const hasFamily = teammateIds.size > 0;
  // Mafia chat locks the instant the moderator moves the sequence past
  // MAFIA (see server/realtime/handlers/sendChat.ts) — mirrored here so a
  // send attempt after the lock is disabled client-side rather than
  // round-tripping to the server just to be rejected.
  const chatLocked = !isMyTurn;

  return (
    <div className="flex flex-col gap-4">
      <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked || !isMyTurn} />
      {view.you.mafiaNightTargets && (
        <MafiaTally targets={view.you.mafiaNightTargets} players={view.players} selfPlayerId={view.you.playerId} />
      )}
      {hasFamily && (
        <MafiaChatPanel
          messages={mafiaMessages}
          selfPlayerId={view.you.playerId}
          onSend={(body) => void emit.sendChat({ villageCode: view.villageCode, body })}
          disabled={chatLocked}
          disabledMessage={chatLocked ? "The kill target is locked in — chat is closed for tonight." : undefined}
        />
      )}
    </div>
  );
}

function DetectiveNightContent({ view, stagedTargetId, onStage, locked, isMyTurn }: RoleNightContentProps) {
  const players = buildTargetGridPlayers(view);
  return (
    <div className="flex flex-col gap-4">
      <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked || !isMyTurn} />
      <DetectiveResultCard results={view.you.detectiveResults ?? []} players={view.players} />
    </div>
  );
}

function DoctorNightContent({ view, stagedTargetId, onStage, locked, isMyTurn }: RoleNightContentProps) {
  const lastProtectedId = view.you.lastProtectedPlayerId;
  const players = buildTargetGridPlayers(view, {
    disabledReasonFor: (id) => (id === lastProtectedId ? 'Protected last night' : undefined),
  });
  return (
    <TargetGrid players={players} stagedTargetId={stagedTargetId} onStage={onStage} disabled={locked || !isMyTurn} />
  );
}
