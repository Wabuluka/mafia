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
}

const VALID_CHAR = /^[A-Za-z0-9]$/;

export function VillageCodeInput({ onComplete, onChange, disabled = false, autoFocus = true }: VillageCodeInputProps) {
  const [chars, setChars] = useState<string[]>(() => Array(VILLAGE_CODE_LENGTH).fill(''));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

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
            char ? 'border-white/15' : 'border-white/5',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
