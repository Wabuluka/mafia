// ---------------------------------------------------------------------------
// A small, deliberately conservative profanity blocklist for 4-character
// room codes. Room codes are drawn from ROOM_CODE_ALPHABET (uppercase
// letters + digits, no 0/O/1/I), so this only needs to catch what's
// actually reachable from that alphabet — not a general-purpose profanity
// filter for arbitrary user text (display names, chat) which would need a
// different, much larger list and isn't this module's job.
// ---------------------------------------------------------------------------

/** Exact 4-letter matches to reject, uppercase, restricted to the room-code
 * alphabet's letters (no 0/O/1/I ever appear in a generated code, so
 * variants using those characters aren't needed here). Intentionally short
 * — the goal is catching the obvious, not building an exhaustive filter. */
const BLOCKED_CODES = new Set([
  'FUCK',
  'SHIT',
  'CUNT',
  'NIGR',
  'FAGG',
  'DYKE',
  'CNUT',
  'TWAT',
  'COCK',
  'PUSS',
  'ANAL',
  'SLUT',
  'WHOR',
  'RAPE',
  'NAZI',
  'KKKK',
]);

export function isProfaneRoomCode(code: string): boolean {
  return BLOCKED_CODES.has(code.toUpperCase());
}
