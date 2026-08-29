// ---------------------------------------------------------------------------
// Default village name generation. Purely cosmetic (see
// VillageDocument.name's own doc comment) — used only when the host didn't
// type one, so a village always has SOME name to show without forcing every
// host through a naming step. No uniqueness/profanity concerns here unlike
// villageCode.ts's generator: a name isn't an identifier (the code still
// is), so a repeat or an odd-sounding combination is harmless, not a bug.
// ---------------------------------------------------------------------------

import { randomInt } from 'node:crypto';

const ADJECTIVES = [
  'Shadowy',
  'Quiet',
  'Hollow',
  'Whispering',
  'Foggy',
  'Crooked',
  'Sleepy',
  'Moonlit',
  'Restless',
  'Silent',
  'Gloomy',
  'Frosty',
];

const NOUNS = [
  'Hollow',
  'Creek',
  'Hamlet',
  'Grove',
  'Ridge',
  'Meadow',
  'Crossing',
  'Outpost',
  'Bend',
  'Glen',
  'Thicket',
  'Watch',
];

function pick(list: readonly string[]): string {
  return list[randomInt(list.length)] ?? list[0] ?? '';
}

/** Generates a whimsical two-word default village name, e.g. "Shadowy
 * Hollow" or "Moonlit Crossing". Called once at village creation when the
 * host didn't supply one. */
export function generateDefaultVillageName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
