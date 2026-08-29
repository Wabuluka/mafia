'use client';

// ---------------------------------------------------------------------------
// GameOverScreen — the endgame: win banner, full role reveal for every
// player (living and dead), a game timeline pulled from the gameEvents
// collection, "Play again" (host-only, reuses the same roster with
// reshuffled roles, no code re-entry — see realtime/handlers/playAgain.ts),
// and a shareable text summary for group chats.
//
// `view.gameId` (see PlayerView's doc comment in @mafia/shared) is what
// lets this screen fetch the two REST endpoints gated on the game being
// COMPLETED (GET /api/games/:id/summary, GET /api/games/:id/events) —
// PlayerView itself only carries the live, still-redacted roster even at
// GAME_OVER (recall `endReason`/`winningTeam` are public, but individual
// LIVING players' roles never appear on PlayerView outside of `you` or a
// death's `revealedRole` — the summary endpoint is the one place a full
// reveal is intentionally allowed, gated on the game having actually
// ended). Until that fetch resolves, the banner alone (which IS fully
// derivable from `view.endReason`/`view.winningTeam`) is shown so the win
// moment isn't blocked on a network round trip.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { PlayerView } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { AppShell } from '@/components/AppShell';
import { InstallPromptBanner } from '@/components/InstallPromptBanner';
import { useToast } from '@/components/Toast';
import {
  ApiError,
  getGameEvents,
  getGameSummary,
  type GameEvent,
  type GameSummary,
} from '@/lib/api';
import { useInstallPrompt } from '@/lib/useInstallPrompt';
import { useSocket } from '@/lib/socket-context';
import { useThemeSync } from '@/lib/useThemeSync';
import { END_REASON_LABEL, ROLE_LABEL, TEAM_LABEL } from '@/lib/roleLabels';
import { GameTimeline } from './GameTimeline';
import { buildShareText } from './shareText';

export interface GameOverScreenProps {
  view: PlayerView;
}

type SummaryState =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: GameSummary; events: GameEvent[] }
  | { kind: 'error' };

export function GameOverScreen({ view }: GameOverScreenProps) {
  useThemeSync('mafia');
  const { emit } = useSocket();
  const toast = useToast();
  const [state, setState] = useState<SummaryState>({ kind: 'loading' });
  const [startingAgain, setStartingAgain] = useState(false);
  const [copied, setCopied] = useState(false);
  const { canShowInstallPrompt, markGameCompleted, promptInstall } = useInstallPrompt();

  const gameId = view.gameId;

  // Reaching this screen at all means a full game (lobby → night/day
  // cycles → a win condition) just played out — the exact "played a full
  // game" bar useInstallPrompt.ts gates the install pitch on. Marking it
  // here, unconditionally on mount, rather than only for the winning team
  // or the host: every player who saw this screen sat through the whole
  // game.
  useEffect(() => {
    markGameCompleted();
  }, [markGameCompleted]);

  useEffect(() => {
    if (!gameId) {
      setState({ kind: 'error' });
      return;
    }
    let cancelled = false;
    async function run() {
      try {
        const [summary, eventsRes] = await Promise.all([getGameSummary(gameId as string), getGameEvents(gameId as string)]);
        if (cancelled) return;
        setState({ kind: 'ready', summary, events: eventsRes.events });
      } catch {
        if (cancelled) return;
        setState({ kind: 'error' });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const isHost = view.players.find((p) => p.id === view.you.playerId)?.isHost ?? false;
  const winningTeamLabel = view.winningTeam ? TEAM_LABEL[view.winningTeam] ?? view.winningTeam : 'No one';
  const endReasonLabel = view.endReason ? END_REASON_LABEL[view.endReason] : undefined;

  async function handlePlayAgain() {
    setStartingAgain(true);
    try {
      const result = await emit.playAgain({ villageCode: view.villageCode });
      if (!result.ok) {
        toast.show(result.error.message, { tone: 'danger' });
        setStartingAgain(false);
      }
      // On success, the server's broadcasted `stateUpdate` (phase: NIGHT)
      // is what actually moves every client off this screen — see
      // page.tsx's phase routing — so there's nothing further to do here
      // besides leaving the button in its loading state until that arrives.
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not start a new game.', { tone: 'danger' });
      setStartingAgain(false);
    }
  }

  async function handleShare() {
    const text = buildShareText(view, state.kind === 'ready' ? state.summary : null);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Mafia — game recap', text });
        return;
      } catch {
        // AbortError on dismiss, or share unsupported for this payload in
        // this browser — copy-to-clipboard below is the fallback either way.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.show('Could not copy the summary — try again.', { tone: 'danger' });
    }
  }

  return (
    <AppShell
      header={
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold">Game over</h1>
        </div>
      }
      actionBar={
        <ActionBar>
          <ActionButton variant="neutral" onClick={handleShare}>
            {copied ? 'Copied!' : 'Share recap'}
          </ActionButton>
          {isHost && (
            <ActionButton onClick={handlePlayAgain} loading={startingAgain} disabled={startingAgain}>
              Play again
            </ActionButton>
          )}
        </ActionBar>
      }
    >
      <div className="flex flex-col gap-6 px-4 py-6">
        {canShowInstallPrompt && <InstallPromptBanner onInstall={() => void promptInstall()} />}

        <div className="flex flex-col items-center gap-2 rounded-2xl bg-elevated p-6 text-center">
          <span className="text-sm uppercase tracking-wide text-base-content/50">Winner</span>
          <h2 className="text-3xl font-black text-village-accent">{winningTeamLabel}</h2>
          {endReasonLabel && <p className="text-sm text-base-content/70">{endReasonLabel}</p>}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50">Every role</h3>
          {state.kind === 'loading' && (
            <p className="py-4 text-center text-sm text-base-content/50">Loading the full reveal…</p>
          )}
          {state.kind === 'error' && (
            <p className="py-4 text-center text-sm text-base-content/50">
              Couldn&apos;t load the full role reveal right now.
            </p>
          )}
          {state.kind === 'ready' && (
            <ul className="flex flex-col gap-2">
              {state.summary.players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-elevated px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className={p.status === 'DEAD' ? 'text-base-content/50 line-through' : 'text-base-content'}>
                      {p.name}
                    </span>
                    {p.id === view.you.playerId && (
                      <span className="text-xs text-base-content/40">(you)</span>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-primary">{ROLE_LABEL[p.role] ?? p.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50">Timeline</h3>
          {state.kind === 'ready' ? (
            <GameTimeline events={state.events} players={state.summary.players} />
          ) : (
            <p className="py-4 text-center text-sm text-base-content/50">
              {state.kind === 'loading' ? 'Loading the timeline…' : 'Timeline unavailable.'}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
