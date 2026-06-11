/**
 * Tiny deterministic PRNG (mulberry32). We thread the 32-bit state through
 * game state rather than holding a closure, so the whole engine stays pure
 * and reproducible from a seed.
 */

/** Advance the state and return [value in [0,1), nextState]. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0
  let x = t
  x = Math.imul(x ^ (x >>> 15), x | 1)
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296
  return [value, t]
}

/** Integer in [min, max] inclusive. */
export function nextInt(state: number, min: number, max: number): [number, number] {
  const [value, next] = nextRandom(state)
  return [min + Math.floor(value * (max - min + 1)), next]
}

/** Fisher–Yates shuffle returning a new array plus the advanced state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const out = items.slice()
  let s = state
  for (let i = out.length - 1; i > 0; i--) {
    let j: number
    ;[j, s] = nextInt(s, 0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return [out, s]
}
