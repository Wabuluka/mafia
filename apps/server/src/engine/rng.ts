// ---------------------------------------------------------------------------
// A small deterministic PRNG, entirely self-contained (no Node crypto, no
// Math.random) so `assignRoles` is reproducible given the same numeric seed.
// This is mulberry32 — fast, good-enough distribution for shuffling a small
// player list, not intended for anything security-sensitive.
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Creates a seeded RNG returning floats in [0, 1), same sequence every time
 * for the same seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle using the supplied RNG. Pure — returns a new array,
 * never mutates `items`. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = result.at(i);
    const b = result.at(j);
    if (a === undefined || b === undefined) {
      throw new Error('shuffle: index out of bounds — unreachable for a valid array');
    }
    result[i] = b;
    result[j] = a;
  }
  return result;
}
