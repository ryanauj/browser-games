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
export const MAX_ENERGY = 12

/** Hand / deck sizing. */
export const OPENING_HAND = 5
export const HAND_CAP = 8
export const DRAW_PER_TURN = 1
export const DECK_SIZE = 24

/** Positional fit modifiers applied during a clash. */
export const FIT_BONUS = 2
export const MISMATCH_PENALTY = 2

/** Bucket scoring: beating the defender is worth 2, a blowout margin is worth 3. */
export const THREE_POINT_MARGIN = 4

/** Game clock (fiction). Tuned so a match lands in a natural basketball range. */
export const QUARTERS = 4
export const QUARTER_GAME_SECONDS = 100
export const POSSESSION_GAME_SECONDS_MIN = 16
export const POSSESSION_GAME_SECONDS_MAX = 28

/** Shot clock (real-world pressure, seconds). */
export const SHOT_CLOCK_SECONDS = 24
