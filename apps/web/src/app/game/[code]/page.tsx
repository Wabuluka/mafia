'use client';

// ---------------------------------------------------------------------------
// /game/[code] — the live in-game screen. Confirms (over HTTP, before ever
// opening a socket) that the room actually has a game IN_GAME; if it's
// still LOBBY, sends the player back there instead of showing a broken
// in-game shell for a game that hasn't started. Once joined, the actual
// phase-specific screen is chosen from `view.phase` — this pass only
// implements NIGHT (see NightPhase.tsx); DAY_DISCUSSION/DAY_VOTE/GAME_OVER
// render a small placeholder until their own screens exist, rather than
// crashing or showing stale UI.
// ---------------------------------------------------------------------------

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RoomCodeSchema, type RoomCode } from '@mafia/shared';
import { AppShell } from '@/components/AppShell';
import { NightPhase } from '@/components/night/NightPhase';
import { useToast } from '@/components/Toast';
import { ApiError, createOrResumeSession, getRoom } from '@/lib/api';
import { useRoomState } from '@/lib/useRoomState';
import { useStoredName } from '@/lib/useStoredName';

type LoadState = { kind: 'loading' } | { kind: 'ready'; playerName: string } | { kind: 'error'; message: string };

export default function GamePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const toast = useToast();
  const [storedName] = useStoredName();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const parsedCode = RoomCodeSchema.safeParse((params.code ?? '').toUpperCase());
  const roomCode: RoomCode | null = parsedCode.success ? parsedCode.data : null;

  useEffect(() => {
    if (!roomCode) {
      setLoad({ kind: 'error', message: 'That room code looks invalid.' });
      return;
    }
    if (!storedName) {
      router.replace(`/name?next=${encodeURIComponent(`/game/${roomCode}`)}`);
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        await createOrResumeSession(storedName || undefined);
        const room = await getRoom(roomCode as RoomCode);
        if (cancelled) return;

        if (room.status === 'LOBBY') {
          router.replace(`/lobby/${roomCode}`);
          return;
        }
        if (room.status === 'CLOSED') {
          setLoad({ kind: 'error', message: 'This room no longer exists.' });
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
  }, [roomCode, storedName]);

  const playerName = load.kind === 'ready' ? load.playerName : '';
  const { view, joinError } = useRoomState(load.kind === 'ready' ? roomCode : null, playerName);

  useEffect(() => {
    if (joinError) toast.show(joinError, { tone: 'danger' });
  }, [joinError, toast]);

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
            className="min-h-11 rounded-xl bg-white/10 px-5 text-base font-semibold active:bg-white/15"
          >
            Back to Home
          </button>
        </div>
      </AppShell>
    );
  }

  if (!view) return null; // unreachable given the loading check above; narrows the type for below

  if (view.phase === 'NIGHT') {
    return <NightPhase view={view} />;
  }

  // Day/vote/game-over screens land in later work — a clear placeholder
  // beats silently rendering nothing or crashing on an unhandled phase.
  return (
    <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Game</h1></div>}>
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base-content/60">The {view.phase.toLowerCase().replace('_', ' ')} screen isn&apos;t built yet.</p>
      </div>
    </AppShell>
  );
}
