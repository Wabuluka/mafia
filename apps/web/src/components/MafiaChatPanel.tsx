'use client';

// ---------------------------------------------------------------------------
// MafiaChatPanel — the mafia-only coordination chat during the night. Reads
// only `chatLog` entries with `channel === 'MAFIA'` from PlayerView — the
// server has already filtered chatLog to exactly the channels this viewer
// is entitled to see (see redactStateFor's `visibleChannelsFor`), so this
// component doesn't need its own authorization logic; it just renders what
// it was handed and lets the caller wire `onSend` to `emit.sendChat`
// (channel is derived server-side from sender role/phase — see
// sendChat.ts — never sent by the client).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@mafia/shared';

export interface MafiaChatPanelProps {
  messages: ChatMessage[];
  selfPlayerId: string;
  onSend: (body: string) => void;
  /** True once the moderator-driven night sequence has moved past MAFIA —
   * the server rejects a send at that point (see server/realtime/handlers/
   * sendChat.ts's mafia chat lock), so the input is disabled here too
   * rather than letting a message round-trip just to bounce. */
  disabled?: boolean;
  /** Shown in place of the "only your family can see this" hint once
   * `disabled` is true and there's nothing (yet) in the log to show. */
  disabledMessage?: string;
}

const MAX_MESSAGE_LENGTH = 500;

export function MafiaChatPanel({ messages, selfPlayerId, onSend, disabled, disabledMessage }: MafiaChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-mafia-accent/20 bg-mafia-accent/5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-mafia-accent">Family chat</h3>

      <div ref={listRef} className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-base-content/40">{disabled && disabledMessage ? disabledMessage : 'Only your family can see this.'}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-semibold text-mafia-accent">
                {m.senderId === selfPlayerId ? 'You' : m.senderName}:
              </span>{' '}
              <span className="text-base-content/80">{m.body}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={disabled ? (disabledMessage ?? 'Chat is closed for tonight.') : 'Message your family…'}
          disabled={disabled}
          className="min-h-11 flex-1 rounded-xl border border-base-content/10 bg-elevated-2 px-3 text-base text-base-content outline-none focus:border-mafia-accent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !draft.trim()}
          aria-label="Send message"
          className="flex min-h-11 w-11 items-center justify-center rounded-xl bg-mafia-accent text-white disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M3 10l14-7-4 7 4 7-14-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
