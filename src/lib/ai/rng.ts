/**
 * Seeded pseudo-random number generator (PRNG).
 *
 * We use mulberry32 — a tiny, fast, deterministic PRNG. Same seed → same
 * sequence of random numbers → same case + same suspect portrait every time.
 *
 * This is what makes the "seed" mechanic work like Minecraft: type the same
 * seed, get the same world (or in our case, the same interrogation case).
 *
 * Usage:
 *   const rng = mulberry32(4827193);
 *   rng();           // 0..1 float
 *   rngInt(rng, 10); // 0..9 int
 *   rngPick(rng, ["a","b","c"]); // random element
 */

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, max). */
export function rngInt(rng: RNG, max: number): number {
  return Math.floor(rng() * max);
}

/** Random element from an array. */
export function rngPick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[rngInt(rng, arr.length)];
}

/** Boolean with given probability. */
export function rngChance(rng: RNG, p: number): boolean {
  return rng() < p;
}

/**
 * Hash an arbitrary string seed into a 32-bit uint.
 * Lets users type "minecraft" or "12345" or any text as a seed.
 */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Generate a random 7-digit numeric seed string (for the "GENERATE" button). */
export function randomSeedString(): string {
  return String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
}
