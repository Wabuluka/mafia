'use client';

// ---------------------------------------------------------------------------
// VillageCodeInput — a 4-box, auto-advancing, auto-uppercasing village code
// entry. Each box holds exactly one character from VILLAGE_CODE_ALPHABET
// (uppercase letters + digits, no 0/O/1/I); typing a valid character
// auto-advances focus to the next box, backspace on an empty box moves
// focus back, and pasting a full code fills every box at once.
//
// Keyboard: the village code alphabet is ALPHANUMERIC (see
// @mafia/shared/constants.ts's VILLAGE_CODE_ALPHABET), not purely numeric —
// forcing `inputMode="numeric"` would hide the letter keys mobile browsers
// need to show for this input to be usable at all. `inputMode="text"` with
// `pattern="[A-Za-z0-9]*"` is the "numeric keyboard where appropriate"
// this component's spec calls for: appropriate here means the ALPHANUMERIC
// keyboard, since that's what actually lets a player type every valid code.
// A village code that were purely numeric would instead use
// `inputMode="numeric"` per-box — the pattern below is written so that
// swap is a one-line change if the alphabet ever becomes digits-only.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { VILLAGE_CODE_LENGTH } from '@mafia/shared';

export interface VillageCodeInputProps {
  onComplete: (code: string) => void;
  /** Called on every change, including incomplete codes — lets the caller
   * clear a stale error as soon as the player starts editing again. */
  onChange?: (partialCode: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Pre-fills the boxes (e.g. from a `?code=` deep link) on first render.
   * Any characters outside VILLAGE_CODE_ALPHABET are stripped and the rest
   * truncated/padded to VILLAGE_CODE_LENGTH, so a malformed or partial
   * query param degrades to "some boxes filled" rather than crashing. Only
   * applied on mount — later prop changes don't re-fill mid-edit. */
  initialValue?: string;
}

const VALID_CHAR = /^[A-Za-z0-9]$/;

function toInitialChars(initialValue: string | undefined): string[] {
  const cleaned = (initialValue ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chars = Array(VILLAGE_CODE_LENGTH).fill('');
  for (let i = 0; i < Math.min(cleaned.length, VILLAGE_CODE_LENGTH); i += 1) {
    chars[i] = cleaned[i]!;
  }
  return chars;
}

export function VillageCodeInput({
  onComplete,
  onChange,
  disabled = false,
  autoFocus = true,
  initialValue,
}: VillageCodeInputProps) {
  const [chars, setChars] = useState<string[]>(() => toInitialChars(initialValue));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) {
      // A prefilled code should focus the first EMPTY box, not box 0 — a
      // player deep-linked in with a full code should land on "Join",
      // not have to click past 4 already-filled boxes.
      const firstEmpty = chars.findIndex((c) => c === '');
      inputRefs.current[firstEmpty === -1 ? VILLAGE_CODE_LENGTH - 1 : firstEmpty]?.focus();
    }
    // Only on mount — see initialValue's own doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  useEffect(() => {
    // Fire onComplete/onChange for a code that arrived already-complete
    // (e.g. a full ?code= deep link) — the normal commit() path only runs
    // from user interaction, so a prefilled-complete code needs its own
    // kick to notify the parent without waiting for a keystroke.
    const code = chars.join('');
    onChange?.(code);
    if (code.length === VILLAGE_CODE_LENGTH && chars.every((c) => c !== '')) {
      onComplete(code);
    }
    // Only on mount — subsequent completions go through commit().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(
    (next: string[]) => {
      setChars(next);
      const code = next.join('');
      onChange?.(code);
      if (next.every((c) => c !== '')) {
        onComplete(code);
      }
    },
    [onChange, onComplete],
  );

  function handleChange(index: number, rawValue: string) {
    // A mobile keyboard can hand back more than one character at once
    // (autocomplete/autofill, or a fast typist outrunning individual
    // keydown events) — take just the last valid character typed into
    // this box, uppercased, rather than rejecting the input outright.
    const value = rawValue.slice(-1).toUpperCase();
    if (value && !VALID_CHAR.test(value)) return;

    const next = [...chars];
    next[index] = value;
    commit(next);

    if (value && index < VILLAGE_CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && chars[index] === '' && index > 0) {
      // Empty box + backspace: move back a box AND clear it, so backspace
      // reads as one continuous "delete going backward" gesture rather
      // than needing two presses per box once it's empty.
      e.preventDefault();
      const next = [...chars];
      next[index - 1] = '';
      commit(next);
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < VILLAGE_CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!pasted) return;
    e.preventDefault();

    const next = Array(VILLAGE_CODE_LENGTH).fill('');
    for (let i = 0; i < Math.min(pasted.length, VILLAGE_CODE_LENGTH); i += 1) {
      next[i] = pasted[i]!;
    }
    commit(next);

    const lastFilledIndex = Math.min(pasted.length, VILLAGE_CODE_LENGTH) - 1;
    inputRefs.current[Math.max(0, lastFilledIndex)]?.focus();
  }

  return (
    <div className="flex justify-center gap-3" role="group" aria-label="Village code">
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="text"
          pattern="[A-Za-z0-9]*"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={1}
          value={char}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          aria-label={`Character ${i + 1} of ${VILLAGE_CODE_LENGTH}`}
          className={[
            'h-16 w-14 rounded-2xl border-2 bg-elevated text-center text-3xl font-bold uppercase tabular-nums',
            'text-base-content caret-primary outline-none transition-colors motion-reduce:transition-none',
            'focus:border-primary disabled:opacity-40',
            char ? 'border-base-content/15' : 'border-base-content/10',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
