'use client';

// ---------------------------------------------------------------------------
// Join — 4-character village code entry. Validates the code exists (and is
// still joinable) via the HTTP join endpoint before ever opening a socket,
// so "village already in progress" / "village full" / "no such village" all
// surface as a clear inline message right here rather than after the player
// has already been dropped into a broken lobby screen.
// ---------------------------------------------------------------------------

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionBar, ActionButton } from '@/components/ActionBar';
import { AppShell } from '@/components/AppShell';
import { VillageCodeInput } from '@/components/VillageCodeInput';
import { ApiError, createOrResumeSession, joinVillageHttp } from '@/lib/api';
import { useStoredName } from '@/lib/useStoredName';

const ERROR_MESSAGES: Record<string, string> = {
  VILLAGE_NOT_FOUND: "That village code doesn't exist. Double-check it and try again.",
  VILLAGE_FULL: 'This village is already full.',
  GAME_IN_PROGRESS: 'This village already has a game in progress. Ask the host for a new code.',
};

export default function JoinPage() {
  const router = useRouter();
  const [storedName] = useStoredName();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  async function handleComplete(fullCode: string) {
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
      await joinVillageHttp(fullCode);
      router.push(`/lobby/${fullCode}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError('Something went wrong. Check your connection and try again.');
      }
      setJoining(false);
    }
  }

  return (
    <AppShell
      header={
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-white/10"
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
