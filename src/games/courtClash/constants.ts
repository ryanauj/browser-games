import type { Vec } from './types'

// ---------------------------------------------------------------------------
// Floor geometry (logical units: a 100×100 square; rendered to match aspect).
// Y=0 is the baseline (rim end), Y=100 is half-court. The rim sits just inside
// the baseline at the top of the screen; offense attacks upward toward it.
// ---------------------------------------------------------------------------

export const COURT_W = 100
export const COURT_H = 100

/** The basket / rim location. */
export const BASKET: Vec = { x: 50, y: 9 }

/** Beyond this distance from the rim a make is worth 3; inside it's worth 2. */
export const THREE_PT_RADIUS = 42

/** Inside this radius a shot is a "layup/finish" (uses Finishing, not Shooting). */
export const RIM_RADIUS = 14

/** Max sane shot distance — heaves past this are wildly low percentage. */
export const MAX_SHOT_RANGE = 78

// ---------------------------------------------------------------------------
// Beats, clock, scoring.
// ---------------------------------------------------------------------------

/** Real time one beat of animation occupies (ms). */
export const BEAT_MS = 1100

/** Possession length, counted in beats. Expiry = shot-clock turnover. */
export const SHOT_CLOCK_BEATS = 13
/** Shot clock after an offensive rebound. */
export const SHOT_CLOCK_RESET_OREB = 7

/** First to this many points, win by 2. */
export const WIN_TARGET = 15
export const WIN_BY = 2

// ---------------------------------------------------------------------------
// Movement & stamina.
// ---------------------------------------------------------------------------

/** Base floor units a player covers per beat at full stamina, before speed. */
export const BASE_STEP = 16
/** Speed attribute (0..99) adds up to this many extra units per beat. */
export const SPEED_STEP_BONUS = 12

/** Stamina drained per beat by exertion level (distance moved scales it). */
export const STAMINA_COST = {
  idle: -6, // negative = recover
  pass: 0, // one-shot, resolved before movement
  move: 5,
  cut: 11,
  drive: 12,
  screen: 6,
  guard: 6,
  double: 10,
  help: 9,
  steal: 13,
} as const

/** Below this stamina a player is "gassed": slower and worse at everything. */
export const GASSED_THRESHOLD = 22
/** A gassed player's step and contest stats scale by this. */
export const GASSED_FACTOR = 0.62
/** Reach scales continuously with stamina: a fully-drained player still covers
 *  this fraction of their rested reach (100% stamina = full reach). */
export const STAMINA_REACH_MIN = 0.5
/** Below this stamina a player cannot sprint (drive/cut) until recovered. */
export const SPRINT_FLOOR = 10
/** Drives and cuts are explosive: they cover this multiple of a jog's reach,
 *  paying the higher stamina cost for the extra ground. */
export const BURST_FACTOR = 1.4
/** A ball handler who drove last beat gets this added to their next shot's make
 *  chance — downhill momentum into the finish. Consumed by the shot. */
export const DRIVE_FINISH_BONUS = 0.12

// ---------------------------------------------------------------------------
// Screens. A planted screen bumps any defender who runs through it, sticking
// them for a beat or two and springing their man open.
// ---------------------------------------------------------------------------

/** A defender within this distance of a screener gets caught on the pick. */
export const SCREEN_RADIUS = 10
/** Base beats a defender is stuck; strength vs the defender's quickness scales it. */
export const SCREEN_BASE = 1
export const SCREEN_MAX = 2
export const SCREEN_STAT_WEIGHT = 1.6
/** A stuck defender moves at this fraction of their step (slowed/screened). */
export const STUCK_FACTOR = 0.18
/** A screener is freed (back to idle) after this many beats if it hasn't hit anyone. */
export const SCREEN_HOLD_MAX = 2

// ---------------------------------------------------------------------------
// Contest model. Openness dominates; stat deltas swing it; randomness seasons.
// All probabilities are clamped to [0.03, 0.97].
// ---------------------------------------------------------------------------

/** Distance to nearest defender (floor units) mapped to full "open". */
export const OPEN_DISTANCE = 22

/** Shot make: base rates by shot type, before openness/stat/contest. */
export const SHOT_BASE = {
  layup: 0.58,
  two: 0.42,
  three: 0.34,
} as const

/** How much a fully-open look adds vs a tightly-covered one. */
export const OPENNESS_SHOT_WEIGHT = 0.42
/** Shooting/Finishing attribute delta from 50 scales to at most this. */
export const SHOT_STAT_WEIGHT = 0.2

/** Block: a contesting defender's interior D vs shot. Higher near the rim. */
export const BLOCK_BASE_RIM = 0.28
export const BLOCK_BASE_PERIMETER = 0.07
export const BLOCK_STAT_WEIGHT = 0.22
/** A defender must be within this distance to contest/block a shot at all. */
export const CONTEST_RADIUS = 16

/** Pass steal: a defender near the lane vs the passer's handling/passing. */
export const PASS_STEAL_BASE = 0.1
export const PASS_STEAL_STAT_WEIGHT = 0.28
/** A defender this close to the pass lane can attempt a deflection. */
export const PASS_LANE_RADIUS = 10

/** On-ball strip while driving into a set defender. */
export const STRIP_BASE = 0.12
export const STRIP_STAT_WEIGHT = 0.24

/** Steal-gamble order: reward and the cost of missing (defender out of play). */
export const GAMBLE_STEAL_BASE = 0.34
export const GAMBLE_STEAL_STAT_WEIGHT = 0.3

/** Offensive rebound chance on a miss (defense rebounds otherwise). */
export const OREB_BASE = 0.26
export const OREB_STAT_WEIGHT = 0.22

// ---------------------------------------------------------------------------
// Risk glow thresholds (probability of the good outcome → color).
// ---------------------------------------------------------------------------
export type Risk = 'good' | 'fair' | 'bad'
export function riskOf(p: number): Risk {
  if (p >= 0.55) return 'good'
  if (p >= 0.35) return 'fair'
  return 'bad'
}
