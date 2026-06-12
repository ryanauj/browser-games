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

/**
 * Coach energy: a flat budget each possession, spent on substitutions and
 * play cards. No carry-over — use it or lose it.
 */
export const ENERGY_PER_POSSESSION = 3
export const SUB_COST = 1

/** Roster sizing: athletes per position dealt to each side. */
export const ROSTER_PER_POSITION = 2

/** Playbook (play-card deck) sizing. */
export const OPENING_HAND = 3
export const HAND_CAP = 5
export const DRAW_PER_TURN = 1

/** Rally: a side trailing by this many points gets +1 coach energy and one
 * extra play card each possession, feeding the rotation engine a comeback. */
export const RALLY_DEFICIT = 10

/**
 * Positional fit modifiers applied during a clash. The penalty is softer than
 * the bonus so emergency cross-position subs dampen rather than spiral.
 */
export const FIT_BONUS = 2
export const MISMATCH_PENALTY = 1

/** Bucket scoring: beating the defender is worth 2, a blowout margin is worth 3. */
export const THREE_POINT_MARGIN = 4

/** Fatigue model. Every possession on court costs BASE_FATIGUE stamina, plus
 * the lane's attack margin (OFF − DEF) clamped to [CLASH_DAMAGE_MIN,
 * CLASH_DAMAGE_MAX] when beaten. Benched athletes recover BENCH_RECOVERY. */
export const BASE_FATIGUE = 1
export const CLASH_DAMAGE_MIN = 1
export const CLASH_DAMAGE_MAX = 2
export const BENCH_RECOVERY = 3

/** A gassed athlete (0 STA) plays at this penalty to OFF and DEF. */
export const GASSED_PENALTY = 3

/** Fouls: a defender beaten by THREE_POINT_MARGIN picks one up; at the limit
 * the athlete fouls out of the game for good. */
export const FOUL_LIMIT = 4

/** Hustle's per-possession OFF growth stops here so survivors can't snowball. */
export const HUSTLE_CAP = 3

/** Fast Break triggers against defenders at or below this stamina. */
export const TIRED_THRESHOLD = 2

/** Game clock (fiction). Tuned so a match lands in a natural basketball range.
 * Overtime is sudden death (first lead after a clash wins); after
 * MAX_OVERTIMES still-tied periods the fresher team wins on conditioning. */
export const QUARTERS = 4
export const MAX_OVERTIMES = 2
export const QUARTER_GAME_SECONDS = 100
export const POSSESSION_GAME_SECONDS_MIN = 16
export const POSSESSION_GAME_SECONDS_MAX = 28

/** Shot clock (real-world pressure, seconds). Opt-in via the timed toggle. */
export const SHOT_CLOCK_SECONDS = 24
