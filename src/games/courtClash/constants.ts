import type { Position } from './types'

/** The five lineup slots, in display order (backcourt → frontcourt). */
export const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']

export const POSITION_LABELS: Record<Position, string> = {
  PG: 'Point Guard',
  SG: 'Shooting Guard',
  SF: 'Small Forward',
  PF: 'Power Forward',
  C: 'Center',
}

/** Energy (mana) curve. */
export const STARTING_ENERGY = 4
export const ENERGY_PER_TURN = 1
export const MAX_ENERGY = 10

/** Hand / deck sizing. */
export const OPENING_HAND = 5
/** Opening hands are reordered to contain at least this many athletes. */
export const OPENING_HAND_MIN_ATHLETES = 3
export const HAND_CAP = 8
export const DRAW_PER_TURN = 2
export const DECK_SIZE = 32

/** Rally: a side trailing by this many points draws one extra card a turn. */
export const RALLY_DEFICIT = 10

/**
 * Positional fit modifiers applied during a clash. The penalty is softer than
 * the bonus so a bad run of draws dampens rather than spirals.
 */
export const FIT_BONUS = 2
export const MISMATCH_PENALTY = 1

/** Bucket scoring: beating the defender is worth 2, a blowout margin is worth 3. */
export const THREE_POINT_MARGIN = 4

/** Tech Foul power-up damage. */
export const TECH_FOUL_DAMAGE = 3

/** Hustle's per-turn OFF growth stops here so survivors can't snowball. */
export const HUSTLE_CAP = 3

/**
 * Per-clash stamina damage range in contested lanes. The floor keeps walls
 * mortal; the cap means a fresh athlete always survives its first clash, so
 * a losing board can claw back instead of churning.
 */
export const CLASH_DAMAGE_MIN = 1
export const CLASH_DAMAGE_MAX = 3

/** Game clock (fiction). Tuned so a match lands in a natural basketball range. */
export const QUARTERS = 4
export const QUARTER_GAME_SECONDS = 100
export const POSSESSION_GAME_SECONDS_MIN = 16
export const POSSESSION_GAME_SECONDS_MAX = 28

/** Shot clock (real-world pressure, seconds). Opt-in via the timed toggle. */
export const SHOT_CLOCK_SECONDS = 24
