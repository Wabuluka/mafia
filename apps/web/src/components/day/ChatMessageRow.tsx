'use client';

// ---------------------------------------------------------------------------
// ChatMessageRow — a single virtualized chat row (react-window's
// rowComponent contract: receives `index` + `style` + `ariaAttributes`
// automatically, plus whatever's passed via `rowProps` — see
// RowComponentProps<RowData> below, which is exactly react-window's own
// type for this shape, so `rowProps` on the List in DiscussionPhase.tsx
// only needs to supply `messages`/`selfPlayerId`, never `index`/`style`).
// Kept as its own file/component so it can be memoized independently of
// the list container re-rendering.
// ---------------------------------------------------------------------------

import type { RowComponentProps } from 'react-window';
import type { ChatMessage } from '@mafia/shared';

export interface ChatMessageRowData {
  messages: ChatMessage[];
  selfPlayerId: string;
}

export function ChatMessageRow({ index, style, messages, selfPlayerId }: RowComponentProps<ChatMessageRowData>) {
  const message = messages[index];
  if (!message) return null;

  const isSelf = message.senderId === selfPlayerId;

  return (
    <div style={style} className="flex flex-col justify-center px-4 py-1">
      <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
        {!isSelf && <span className="mb-0.5 text-xs text-base-content/40">{message.senderName}</span>}
        <span
          className={[
            'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
            isSelf ? 'bg-primary text-primary-content' : 'bg-elevated text-base-content',
          ].join(' ')}
        >
          {message.body}
        </span>
      </div>
    </div>
  );
}
