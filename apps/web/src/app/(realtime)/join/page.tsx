'use client';

// ---------------------------------------------------------------------------
// Join — 4-character village code entry. Validates the code exists (and is
// still joinable) via the HTTP join endpoint before ever opening a socket,
// so "village already in progress" / "village full" / "no such village" all
// surface as a clear inline message right here rather than after the player
// has already been dropped into a broken lobby screen.
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { VillageCode } from '@mafia/shared';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { AppShell } from '@/components/AppShell';
import { VillageCodeInput } from '@/components/VillageCodeInput';
import { ApiError, createOrResumeSession, joinVillageHttp } from '@/lib/api';
import { useSocket } from '@/lib/socket-context';
import { useStoredName } from '@/lib/useStoredName';
import { useThemeSync } from '@/lib/useThemeSync';

const ERROR_MESSAGES: Record<string, string> = {
  VILLAGE_NOT_FOUND: "That village code doesn't exist. Double-check it and try again.",
  VILLAGE_FULL: 'This village is already full.',
  GAME_IN_PROGRESS: 'This village already has a game in progress. Ask the host for a new code.',
};

function JoinForm() {
  useThemeSync('mafia');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { socket, status: socketStatus, emit, connect } = useSocket();
  // A shared invite link (`/join?code=5XHK`) should prefill the boxes and
  // auto-submit, not just land the player on an empty entry screen they
  // have to re-type the code they were just given into. Uppercased/sliced
  // to VILLAGE_CODE_LENGTH by VillageCodeInput itself — anything malformed
  // here just degrades to a partial prefill rather than erroring.
  const codeFromUrl = searchParams.get('code') ?? '';
  const [storedName] = useStoredName();
  const [code, setCode] = useState(codeFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // Set once the host approval gate holds this player pending (see
  // villages.routes.ts) — switches the whole screen to a waiting state
  // until `joinRequestResolved` arrives. Not just a boolean: the pending
  // village code is what the requestToJoin effect below needs, and using
  // its presence/absence AS the "are we waiting" flag (rather than a
  // separate boolean this could drift from) means there's only one source
  // of truth for "which village, if any, are we currently waiting on".
  const [pendingVillageCode, setPendingVillageCode] = useState<VillageCode | null>(null);
  const [pendingVillageName, setPendingVillageName] = useState<string | null>(null);
  // Mirrors pendingVillageCode for the socket-event closure below, which
  // needs to read the CURRENT value without retriggering the effect that
  // registered the listener — see VotingPhase.tsx's stagedRef for the same
  // pattern and full rationale.
  const pendingVillageCodeRef = useRef(pendingVillageCode);
  pendingVillageCodeRef.current = pendingVillageCode;

  // No stored name yet: send the player to pick one first, same as every
  // other entry point (Home's goToJoin, the lobby/game pages' own guard —
  // see their `router.replace('/name?next=...')` calls). Without this, a
  // deep link with `?code=` would auto-submit `handleComplete` on mount
  // via VillageCodeInput's initialValue-complete kick and join anonymously
  // before the player ever gets a chance to enter a name.
  useEffect(() => {
    if (!storedName) {
      const next = codeFromUrl ? `/join?code=${encodeURIComponent(codeFromUrl)}` : '/join';
      router.replace(`/name?next=${encodeURIComponent(next)}`);
    }
    // Only re-check if the resolved name/target actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedName, codeFromUrl]);

  async function handleComplete(fullCode: string) {
    if (!storedName) return; // guarded by the redirect effect above; belt-and-suspenders against a race
    setError(null);
    setJoining(true);
    try {
      await createOrResumeSession(storedName || undefined);
      // Joining while the code is still "being typed" isn't actually
      // reachable here — `onComplete` only fires once all 4 boxes are
      // filled (see VillageCodeInput) — but a player pasting a partial code,
      // or another tab racing a join, still goes through the same HTTP
      // check below rather than assuming the code is valid just because
      // the input is complete.
      const village = await joinVillageHttp(fullCode);
      if (village.status === 'PENDING') {
        // Held for host approval — switch to the waiting screen; the
        // effect below opens the socket and registers requestToJoin once
        // it sees pendingVillageCode set, and listens for the host's
        // eventual decision.
        setPendingVillageCode(village.code);
        setPendingVillageName(village.name);
        setJoining(false);
        return;
      }
      // A resuming member of a village that's already IN_GAME (their tab
      // closed/crashed mid-game and they're rejoining via a fresh code
      // entry) belongs on the live game screen, not the lobby — the lobby
      // route would just redirect them right back out anyway (see
      // /game/[code]'s own LOBBY-vs-IN_GAME check), but going there first
      // is a pointless extra hop and flash of the wrong screen.
      router.push(village.status === 'IN_GAME' ? `/game/${fullCode}` : `/lobby/${fullCode}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError('Something went wrong. Check your connection and try again.');
      }
      setJoining(false);
    }
  }

  // Once held pending, open the socket and register the live request —
  // the HTTP call above only persisted the pending state in Mongo (see
  // villages.routes.ts); this is what actually lets the host see this
  // request live and lets this tab hear back the moment they respond.
  useEffect(() => {
    if (!pendingVillageCode) return;
    connect();
  }, [pendingVillageCode, connect]);

  useEffect(() => {
    if (!pendingVillageCode || !socket || socketStatus !== 'connected') return;

    let cancelled = false;
    void emit.requestToJoin({ villageCode: pendingVillageCode }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error.message);
        setPendingVillageCode(null);
      }
    });

    function onResolved(payload: { villageCode: string; accepted: boolean; reason: string }) {
      if (payload.villageCode !== pendingVillageCodeRef.current) return;
      if (payload.accepted) {
        router.push(`/lobby/${payload.villageCode}`);
      } else {
        setPendingVillageCode(null);
        setError(
          payload.reason === 'VILLAGE_UNAVAILABLE'
            ? 'This village is no longer available.'
            : "The host didn't let you in this time.",
        );
      }
    }

    socket.on('joinRequestResolved', onResolved);
    return () => {
      cancelled = true;
      socket.off('joinRequestResolved', onResolved);
    };
  }, [pendingVillageCode, socket, socketStatus, emit, router]);

  // Redirecting to /name — render nothing rather than flashing the form.
  if (!storedName) return null;

  if (pendingVillageCode) {
    return (
      <AppShell
        header={
          <div className="flex items-center gap-2 px-4 py-3">
            <h1 className="text-lg font-bold">Join a village</h1>
          </div>
        }
      >
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
          />
          <p className="text-lg font-semibold">
            Waiting to join {pendingVillageName ?? 'the village'}…
          </p>
          <p className="text-sm text-base-content/60">Sit tight — the host has been notified.</p>
          <button
            type="button"
            onClick={() => {
              void emit.cancelJoinRequest({ villageCode: pendingVillageCode });
              setPendingVillageCode(null);
              setPendingVillageName(null);
            }}
            className="mt-2 text-sm text-base-content/50 underline-offset-2 active:underline"
          >
            Cancel
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      header={
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-base-content/10"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-lg font-bold">Join a village</h1>
        </div>
      }
      actionBar={
        <ActionBar>
          <ActionButton
            onClick={() => code.length === 4 && handleComplete(code)}
            disabled={code.length < 4}
            loading={joining}
          >
            Join
          </ActionButton>
        </ActionBar>
      }
    >
      <div className="flex flex-col items-center gap-6 px-6 py-10">
        <p className="text-center text-base-content/60">Enter the 4-character code from your host</p>

        <VillageCodeInput
          initialValue={codeFromUrl}
          onComplete={(c) => {
            setCode(c);
            void handleComplete(c);
          }}
          onChange={(partial) => {
            setCode(partial);
            setError(null);
          }}
          disabled={joining}
        />

        {error && (
          <div role="alert" className="w-full max-w-xs rounded-xl bg-danger/15 px-4 py-3 text-center text-sm text-danger">
            {error}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function JoinPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
