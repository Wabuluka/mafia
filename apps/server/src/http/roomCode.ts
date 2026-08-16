// ---------------------------------------------------------------------------
// Room code generation: 4 characters, drawn from ROOM_CODE_ALPHABET (no
// ambiguous 0/O or 1/I), rejecting anything that reads as profanity, and
// retried against the DB's unique index until a free code is found.
// ---------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, RoomCodeSchema, type RoomCode } from '@mafia/shared';
import { roomsRepository } from '../db';
import { isProfaneRoomCode } from './profanity';
import { AppError } from './errors';

const MAX_GENERATION_ATTEMPTS = 25;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generates a room code that is well-formed, not profane, and not
 * currently in use by a live room. Retries on collision — collisions are
 * rare at 4 chars over a ~29-letter alphabet (29^4 ≈ 700k combinations) but
 * not impossible, so this checks the DB rather than assuming uniqueness
 * from randomness alone. Throws AppError('ROOM_CODE_EXHAUSTED') if the
 * keyspace is unexpectedly saturated — a signal to grow the alphabet/length
 * long before real usage could hit it.
 */
export async function generateUniqueRoomCode(): Promise<RoomCode> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = randomCode();
    if (isProfaneRoomCode(candidate)) continue;

    const parsed = RoomCodeSchema.safeParse(candidate);
    if (!parsed.success) continue; // defensive; should be unreachable given the alphabet

    const existing = await roomsRepository.findRoomByCode(parsed.data);
    if (!existing) {
      return parsed.data;
    }
  }

  throw new AppError('ROOM_CODE_EXHAUSTED', 'Could not generate a unique room code. Please try again.');
}
