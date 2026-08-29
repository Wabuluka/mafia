'use client';

// ---------------------------------------------------------------------------
// /lobby/[code] — the live lobby: player list, ready toggles, shareable
// code, computed role distribution, and (host-only) start/host-controls.
// Handles: a game already in progress (redirected before ever opening a
// socket, via the HTTP village check), the village filling up (Start disabled
// with an explanatory reason, same as under-minimum), a player joining
// mid-code-entry (impossible to observe as a distinct case client-side —
// the roster simply grows live via `stateUpdate`, same as any other join),
// and the host leaving (the server transfers host automatically; this
// screen just reflects whatever `players[].isHost` says on the next
// `stateUpdate`, never computes host status itself).
// ---------------------------------------------------------------------------

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MIN_PLAYERS, VillageCodeSchema, type VillageCode } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { AppShell } from '@/components/AppShell';
import { DEFAULT_LOBBY_DURATIONS_MS, HostControlsModal } from '@/components/HostControlsModal';
import { HowToPlayButton, HowToPlayModal } from '@/components/HowToPlayModal';
import { PlayerTile } from '@/components/PlayerTile';
import { RoleDistributionList } from '@/components/RoleDistributionList';
import { ShareVillageCode } from '@/components/ShareVillageCode';
import { useToast } from '@/components/Toast';
import { ApiError, createOrResumeSession, getVillage } from '@/lib/api';
import { useHasSeenTutorial } from '@/lib/useHasSeenTutorial';
import { useJoinRequests } from '@/lib/useJoinRequests';
import { useSocket } from '@/lib/socket-context';
import { useThemeSync } from '@/lib/useThemeSync';
import { useVillageState } from '@/lib/useVillageState';
import { useStoredName } from '@/lib/useStoredName';

type LoadState = { kind: 'loading' } | { kind: 'ready'; playerName: string } | { kind: 'error'; message: string };

export default function LobbyPage() {
  // The lobby always stays on the dark "mafia" theme — defensively, in case
  // a client-side nav (not a full reload) leaves `data-theme="day"` set from
  // a previous game screen still in this tab's history. See
  // useThemeSync's module header.
  useThemeSync('mafia');
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const toast = useToast();
  const { emit, status } = useSocket();
  const [storedName] = useStoredName();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [hostControlsOpen, setHostControlsOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [villageName, setVillageName] = useState<string | null>(null);
  const joinRequests = useJoinRequests();
  const [hasSeenTutorial, markTutorialSeen] = useHasSeenTutorial();

  const parsedCode = VillageCodeSchema.safeParse((params.code ?? '').toUpperCase());
  const villageCode: VillageCode | null = parsedCode.success ? parsedCode.data : null;

  // Pre-flight over HTTP: confirms the village exists and is still joinable
  // (not IN_GAME, not CLOSED) BEFORE ever opening a socket for it — a
  // "game already in progress" is caught right here with a clear message,
  // rather than the player watching a lobby UI that can never actually
  // start for them.
  useEffect(() => {
    if (!villageCode) {
      setLoad({ kind: 'error', message: 'That village code looks invalid.' });
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        await createOrResumeSession(storedName || undefined);
        const village = await getVillage(villageCode as VillageCode);
        if (cancelled) return;
        setVillageName(village.name);

        if (village.status === 'IN_GAME') {
          setLoad({ kind: 'error', message: 'This game has already started. Ask the host for a new village.' });
          return;
        }
        if (!storedName) {
          router.replace(`/name?next=${encodeURIComponent(`/lobby/${villageCode}`)}`);
          return;
        }
        setLoad({ kind: 'ready', playerName: storedName });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not reach the village. Check your connection.',
        });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once per villageCode/storedName pair at mount — not
    // on every socket status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [villageCode, storedName]);

  const playerName = load.kind === 'ready' ? load.playerName : '';
  const { view, joinError, villageSettings, hostTransferredTo } = useVillageState(
    load.kind === 'ready' ? villageCode : null,
    playerName,
  );

  // A game transitioning out of LOBBY while this player is already in the
  // lobby (the host started it) — leave for the in-game route.
  useEffect(() => {
    if (view && view.phase !== 'LOBBY' && villageCode) {
      toast.show('The game has started!', { tone: 'success' });
      router.push(`/game/${villageCode}`);
    }
  }, [view, toast, villageCode, router]);

  useEffect(() => {
    if (joinError) toast.show(joinError, { tone: 'danger' });
  }, [joinError, toast]);

  // Host duties transfer silently server-side (see useVillageState's
  // onStateUpdate diff — there's no dedicated event for this); this is
  // what actually surfaces it to everyone still in the lobby, one toast per
  // detected transfer.
  useEffect(() => {
    if (hostTransferredTo) toast.show(`${hostTransferredTo} is now hosting.`, { tone: 'info' });
  }, [hostTransferredTo, toast]);

  // Auto-surface How-to-Play exactly once, the first time a player's
  // browser ever reaches a live lobby (gated on `view` existing so this
  // fires once the roster/game state has actually loaded, not the instant
  // the route mounts) — a one-time nudge for a brand-new player, not a
  // forced modal on every visit. `markTutorialSeen` is called immediately
  // rather than on modal close, matching the "opened once" intent even if
  // the player dismisses it right away without reading.
  useEffect(() => {
    if (view && !hasSeenTutorial) {
      setHowToPlayOpen(true);
      markTutorialSeen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hasSeenTutorial]);

  const self = view?.players.find((p) => p.id === view.you.playerId);
  const isHost = self?.isHost ?? false;
  // MIN_PLAYERS counts only non-host participants — the host never
  // receives a role and doesn't count toward "enough players to start"
  // (see @mafia/shared/constants.ts's doc comment and
  // realtime/handlers/startGame.ts's matching server-side check).
  const nonHostPlayerCount = view?.players.filter((p) => !p.isHost).length ?? 0;
  const readyCount = view?.players.filter((p) => !p.isHost && p.isReady).length ?? 0;

  const startBlockedReason = useMemo(() => {
    if (!view) return 'Loading…';
    if (nonHostPlayerCount < MIN_PLAYERS) {
      return `Need at least ${MIN_PLAYERS} players (${nonHostPlayerCount}/${MIN_PLAYERS}).`;
    }
    const notReady = view.players.filter((p) => !p.isHost && !p.isReady);
    if (notReady.length > 0) {
      return `Waiting on ${notReady.length} player${notReady.length === 1 ? '' : 's'} to ready up.`;
    }
    return null;
  }, [view, nonHostPlayerCount]);

  async function handleReadyToggle() {
    if (!view || !villageCode) return;
    const result = await emit.setReady({ villageCode, isReady: !self?.isReady });
    if (!result.ok) toast.show(result.error.message, { tone: 'danger' });
  }

  async function handleStart() {
    if (!villageCode) return;
    setStarting(true);
    const result = await emit.startGame({ villageCode });
    setStarting(false);
    if (!result.ok) toast.show(result.error.message, { tone: 'danger' });
  }

  async function handleLeave() {
    if (villageCode) await emit.leaveVillage({ villageCode });
    router.push('/');
  }

  if (load.kind === 'loading') {
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
      <AppShell header={<div className="px-4 py-3"><h1 className="text-lg font-bold">Lobby</h1></div>}>
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

  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join?code=${villageCode}` : '';

  return (
    <AppShell
      header={
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{villageName ?? 'Lobby'}</h1>
            <p className="text-xs text-base-content/50">
              {status === 'connected'
                ? 'Connected'
                : status === 'reconnecting'
                  ? 'Reconnecting…'
                  : status === 'disconnected'
                    ? 'Offline'
                    : 'Connecting…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HowToPlayButton onClick={() => setHowToPlayOpen(true)} />
            {isHost && (
              <button
                type="button"
                onClick={() => setHostControlsOpen(true)}
                className="relative flex min-h-9 items-center gap-1.5 rounded-full bg-base-content/5 px-3 text-sm font-semibold active:bg-base-content/10"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M10 2a1 1 0 01.894.553l1.06 2.147 2.372.345a1 1 0 01.554 1.706l-1.716 1.673.405 2.362a1 1 0 01-1.451 1.054L10 10.68l-2.118 1.16a1 1 0 01-1.451-1.054l.405-2.362L5.12 6.75a1 1 0 01.554-1.706l2.372-.345L9.106 2.553A1 1 0 0110 2z" />
                </svg>
                Host controls
                {joinRequests.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[0.625rem] font-bold text-white"
                  >
                    {joinRequests.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      }
      actionBar={
        <ActionBar caption={isHost ? startBlockedReason ?? undefined : undefined}>
          <ActionButton variant="neutral" onClick={handleLeave}>
            Leave
          </ActionButton>
          {isHost ? (
            <ActionButton onClick={handleStart} disabled={Boolean(startBlockedReason)} loading={starting}>
              Start Game
            </ActionButton>
          ) : (
            <ActionButton
              variant={self?.isReady ? 'neutral' : 'primary'}
              onClick={handleReadyToggle}
            >
              {self?.isReady ? 'Not ready' : "I'm ready"}
            </ActionButton>
          )}
        </ActionBar>
      }
    >
      <div className="flex flex-col gap-6 px-4 py-6">
        {villageCode && (
          <ShareVillageCode code={villageCode} name={villageName ?? villageCode} joinUrl={joinUrl} />
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Players</h2>
            <span className="flex items-center gap-1.5 text-sm">
              {view && readyCount === nonHostPlayerCount && nonHostPlayerCount > 0 ? (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-village-accent" />
                  <span className="font-semibold text-village-accent">Everyone&apos;s ready</span>
                </>
              ) : (
                <span className="text-base-content/50">
                  <span className="font-semibold tabular-nums text-base-content/70">{readyCount}</span>
                  {`/${nonHostPlayerCount} ready`}
                </span>
              )}
            </span>
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))' }}
          >
            {view?.players.map((p) => (
              <PlayerTile
                key={p.id}
                playerId={p.id}
                name={p.name}
                // Read the real status rather than assuming everyone is
                // alive — a dead player showing up here (e.g. landing back
                // on this route mid-game, or a stale roster right after
                // "Play Again" resets it) should render disabled/dimmed
                // like everywhere else, not as an active lobby member.
                alive={p.status === 'ALIVE'}
                isHost={p.isHost}
                isSelf={p.id === view.you.playerId}
                connected={p.connected}
                // The host never readies up — see startGame.ts's `allReady`
                // check, which already exempts them — so their tile
                // shouldn't visually read as "not ready" just because
                // `isReady` defaults to false and is never toggled for
                // them.
                selected={p.isHost || p.isReady}
              />
            ))}
          </div>
          {!isHost && (
            <p className="mt-2 text-xs text-base-content/40">
              A highlighted tile means that player is ready.
            </p>
          )}
        </div>

        <RoleDistributionList playerCount={nonHostPlayerCount} />
      </div>

      {isHost && villageCode && view && (
        <HostControlsModal
          open={hostControlsOpen}
          onClose={() => setHostControlsOpen(false)}
          villageCode={villageCode}
          players={view.players}
          selfPlayerId={view.you.playerId}
          currentDurationsMs={villageSettings ?? DEFAULT_LOBBY_DURATIONS_MS}
          joinRequests={joinRequests}
        />
      )}
      <HowToPlayModal open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </AppShell>
  );
}
