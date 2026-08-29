'use client';

// ---------------------------------------------------------------------------
// /game/[code] — the live in-game screen. Confirms (over HTTP, before ever
// opening a socket) that the village actually has a game IN_GAME; if it's
// still LOBBY, sends the player back there instead of showing a broken
// in-game shell for a game that hasn't started. Once joined, the actual
// phase-specific screen is chosen from `view.phase`: NIGHT -> NightPhase,
// DAY_DISCUSSION/DAY_VOTE -> DayPhase (which also owns the dawn/elimination
// reveal sequencing — see components/day/DayPhase.tsx). GAME_OVER renders
// a small placeholder until its own screen exists.
// ---------------------------------------------------------------------------

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { VillageCodeSchema, type VillageCode } from '@mafia/shared';
import { AppShell } from '@/components/AppShell';
import { DayPhase } from '@/components/day/DayPhase';
import { GameOverScreen } from '@/components/gameover/GameOverScreen';
import { NightPhase } from '@/components/night/NightPhase';
import { useToast } from '@/components/Toast';
import { ApiError, createOrResumeSession, getVillage } from '@/lib/api';
import { useVillageState } from '@/lib/useVillageState';
import { useStoredName } from '@/lib/useStoredName';
import { useThemeSync } from '@/lib/useThemeSync';
import { useWakeLock } from '@/lib/useWakeLock';

type LoadState = { kind: 'loading' } | { kind: 'ready'; playerName: string } | { kind: 'error'; message: string };

export default function GamePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const toast = useToast();
  const [storedName] = useStoredName();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const parsedCode = VillageCodeSchema.safeParse((params.code ?? '').toUpperCase());
  const villageCode: VillageCode | null = parsedCode.success ? parsedCode.data : null;

  useEffect(() => {
    if (!villageCode) {
      setLoad({ kind: 'error', message: 'That village code looks invalid.' });
      return;
    }
    if (!storedName) {
      router.replace(`/name?next=${encodeURIComponent(`/game/${villageCode}`)}`);
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        await createOrResumeSession(storedName || undefined);
        const village = await getVillage(villageCode as VillageCode);
        if (cancelled) return;

        if (village.status === 'LOBBY') {
          router.replace(`/lobby/${villageCode}`);
          return;
        }
        if (village.status === 'CLOSED') {
          setLoad({ kind: 'error', message: 'This village no longer exists.' });
          return;
        }
        setLoad({ kind: 'ready', playerName: storedName });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not reach the game. Check your connection.',
        });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [villageCode, storedName]);

  const playerName = load.kind === 'ready' ? load.playerName : '';
  const { view, joinError, lastPhaseChange, phaseChangeQueue, dequeuePhaseChange } = useVillageState(
    load.kind === 'ready' ? villageCode : null,
    playerName,
  );

  useEffect(() => {
    if (joinError) toast.show(joinError, { tone: 'danger' });
  }, [joinError, toast]);

  // Loading/error states here render BEFORE any phase-owning screen
  // (NightPhase/DayPhase/GameOverScreen — see useThemeSync's module header)
  // mounts, so this page holds the dark theme itself until one of those
  // takes over. Once `view` exists, this call becomes a no-op in practice
  // (the child screen's own useThemeSync call wins, since it mounts after
  // this effect) — kept unconditional rather than skipped so there's never
  // a frame with no owner of `data-theme` at all.
  useThemeSync('mafia');

  // Active play only — held through NIGHT/DAY_DISCUSSION/DAY_VOTE, released
  // once the game reaches GAME_OVER (no timer left to race against).
  useWakeLock(view != null && view.phase !== 'GAME_OVER');

  if (load.kind === 'loading' || (load.kind === 'ready' && !view)) {
    return (
      <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Loading…</h1></div>}>
        <div className="flex h-full items-center justify-center">
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
          />
        </div>
      </AppShell>
    );
  }

  if (load.kind === 'error') {
    return (
      <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Game</h1></div>}>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-danger">{load.message}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="min-h-11 rounded-xl bg-base-content/10 px-5 text-base font-semibold active:bg-base-content/15"
          >
            Back to Home
          </button>
        </div>
      </AppShell>
    );
  }

  if (!view) return null; // unreachable given the loading check above; narrows the type for below

  // A dawn/elimination reveal takes priority over whatever the CURRENT
  // live phase is: the server's timer doesn't wait for a player to
  // dismiss a reveal (see DayPhase.tsx's module header), so by the time a
  // queued reveal is shown, `view.phase` may already have moved past it
  // (e.g. an elimination reveal is still queued while `view.phase` is
  // already back to NIGHT for the next round). Routing on the queue
  // FIRST, before NightPhase/DayPhase, is what keeps a reveal from being
  // skipped just because the live phase moved on underneath it.
  const hasQueuedReveal = phaseChangeQueue.some(
    (change) => change.previousPhase === 'NIGHT' || change.previousPhase === 'DAY_VOTE',
  );

  if (hasQueuedReveal) {
    return (
      <DayPhase
        view={view}
        lastPhaseChange={lastPhaseChange}
        phaseChangeQueue={phaseChangeQueue}
        dequeuePhaseChange={dequeuePhaseChange}
      />
    );
  }

  if (view.phase === 'NIGHT') {
    return <NightPhase view={view} lastPhaseChange={lastPhaseChange} />;
  }

  if (view.phase === 'DAY_DISCUSSION' || view.phase === 'DAY_VOTE') {
    return (
      <DayPhase
        view={view}
        lastPhaseChange={lastPhaseChange}
        phaseChangeQueue={phaseChangeQueue}
        dequeuePhaseChange={dequeuePhaseChange}
      />
    );
  }

  if (view.phase === 'GAME_OVER') {
    return <GameOverScreen view={view} />;
  }

  // LOBBY is routed away from this page entirely (see the load effect
  // above); reaching here with any other phase would mean a new Phase
  // value was added without updating this routing — a clear placeholder
  // beats silently rendering nothing or crashing.
  return (
    <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Game</h1></div>}>
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base-content/60">The {view.phase.toLowerCase().replace('_', ' ')} screen isn&apos;t built yet.</p>
      </div>
    </AppShell>
  );
}
