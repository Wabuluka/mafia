// ---------------------------------------------------------------------------
// Village code generation: 4 characters, drawn from VILLAGE_CODE_ALPHABET (no
// ambiguous 0/O or 1/I), rejecting anything that reads as profanity, and
// retried against the DB's unique index until a free code is found.
// ---------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { VILLAGE_CODE_ALPHABET, VILLAGE_CODE_LENGTH, VillageCodeSchema, type VillageCode } from '@mafia/shared';
import { villagesRepository } from '../db';
import { isProfaneVillageCode } from './profanity';
import { AppError } from './errors';

const MAX_GENERATION_ATTEMPTS = 25;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < VILLAGE_CODE_LENGTH; i += 1) {
    code += VILLAGE_CODE_ALPHABET[randomInt(VILLAGE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generates a village code that is well-formed, not profane, and not
 * currently in use by a live village. Retries on collision — collisions are
 * rare at 4 chars over a ~29-letter alphabet (29^4 ≈ 700k combinations) but
 * not impossible, so this checks the DB rather than assuming uniqueness
 * from randomness alone. Throws AppError('VILLAGE_CODE_EXHAUSTED') if the
 * keyspace is unexpectedly saturated — a signal to grow the alphabet/length
 * long before real usage could hit it.
 */
export async function generateUniqueVillageCode(): Promise<VillageCode> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = randomCode();
    if (isProfaneVillageCode(candidate)) continue;

    const parsed = VillageCodeSchema.safeParse(candidate);
    if (!parsed.success) continue; // defensive; should be unreachable given the alphabet

    const existing = await villagesRepository.findVillageByCode(parsed.data);
    if (!existing) {
      return parsed.data;
    }
  }

  throw new AppError('VILLAGE_CODE_EXHAUSTED', 'Could not generate a unique village code. Please try again.');
}
