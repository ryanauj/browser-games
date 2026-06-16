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
export const SCREEN_HOLD_MAX = 3

// --- Bodies take up space ---------------------------------------------------
/** Min distance (floor units) between any two players after a beat resolves — no
 *  two bodies (either team, ball handler included) end a beat overlapping. Tuned
 *  so sprites mostly don't overlap while a defender can still contest fairly
 *  tight. */
export const SEPARATION_MIN = 3
/** Collision is a shoving match, not a wall or an even split: when two bodies
 *  overlap, the one with more "oomph" holds ground and the other gives way.
 *  Oomph = mass (from strength) + how hard you're moving INTO the contact. */
export const COLLIDE_MASS_STRENGTH = 0.6 // strength's swing on mass (mass = 1 ± this)
export const COLLIDE_MOMENTUM_WEIGHT = 0.045 // per floor-unit of step driven into a body
/** A player setting a screen is a SOLID body: opponents can't move through them,
 *  they must go around (the physical half of a pick). Slightly larger than the
 *  separation gap so the block resolves before separation would. */
export const SCREEN_BODY = 6

// --- Contested movement (anti-tunnel) ---------------------------------------
// A burst step covers ~2x a jog — enough, under the old end-of-beat-only overlap
// check, to leap clean through a stack of defenders without ever registering
// contact ("ran straight through two defenders"). Instead of teleporting through
// (a bug) or hard-walling (kills the drive), a body in your path SLOWS you, scaled
// by how dead-on the contact is and your strength vs theirs. Multiple bodies
// compound, so a real wall throttles a drive to a crawl. See geometry.contestedStep.
/** How close (floor units) the path must pass a body's center to feel it at all.
 *  Wider than a sprite so a defender *guarding a lane* — not just dead-center —
 *  contests it; too tight and any seam over ~2× this slips a drive through clean. */
export const CONTACT_RADIUS = 5
/** Step lost on a single dead-on, even-strength body at point-blank (before the
 *  strength term eases it). A lone man only costs a step so drives still get
 *  downhill; two stacked bodies compound to throttle a true wall. */
export const CONTACT_SLOW = 0.3
/** How much a strength edge eases the slow (strong downhill driver gives less). */
export const STRENGTH_RELIEF = 0.7
/** Hard cap on a single beat's slow — never a full wall, you always creep on. */
export const MAX_CONTACT_SLOW = 0.75
/** A drive is "stalled in traffic" (log line + flash) only when contact stuffs
 *  it — it kept LESS than this fraction of its intended ground. A drive that's
 *  merely slowed (still covers most of the gap) shouldn't cry wolf. */
export const STALL_KEPT_FRACTION = 0.45
/** …and only count it a drive worth flagging if it meant to travel this far, so
 *  a short re-position never trips the alarm. */
export const STALL_MIN_DRIVE = 10

/** A driver inside this distance of the rim (and open — i.e. they beat their man)
 *  pulls the nearest help defender over to protect the rim. */
export const HELP_PAINT_RADIUS = 24

// ---------------------------------------------------------------------------
// Lead passes. You aim a pass at a spot; a cutter gathers it in stride. The
// catch corridor is "anywhere along a mover's route they can still reach this
// beat"; aim past it (or into empty floor) and the pass sails away — a turnover.
// ---------------------------------------------------------------------------

/** A led pass is gathered only if it lands within this of where the receiver can
 *  actually get to (their step this beat + one gather stride). Aimed farther —
 *  too far ahead, or into empty floor — and it's an errant pass (turnover). */
export const LEAD_CATCH_RADIUS = 7

// ---------------------------------------------------------------------------
// Contest model. Openness dominates; stat deltas swing it; randomness seasons.
// All probabilities are clamped to [0.03, 0.97].
// ---------------------------------------------------------------------------

/** Distance to nearest defender (floor units) mapped to full "open". A real
 *  step of separation should read as a clean look, so this is tuned tight. */
export const OPEN_DISTANCE = 14

/** Shot make: base rates by shot type, before openness/stat/contest. Tuned so a
 *  WIDE-OPEN look lands near real rates (~72% layup, ~50% mid 2, ~40% three) and
 *  a contested one falls off hard — see shotMakeChance. */
export const SHOT_BASE = {
  layup: 0.52,
  two: 0.28,
  three: 0.22,
} as const

/** How much a fully-open look adds vs a tightly-covered one. */
export const OPENNESS_SHOT_WEIGHT = 0.26
/** Shooting/Finishing attribute delta from 50 scales to at most this. */
export const SHOT_STAT_WEIGHT = 0.2

/** Block: a contesting defender's interior D vs shot. Higher near the rim. */
export const BLOCK_BASE_RIM = 0.15
export const BLOCK_BASE_PERIMETER = 0.035
export const BLOCK_STAT_WEIGHT = 0.22
/** A defender must be within this distance to contest/block a shot at all. */
export const CONTEST_RADIUS = 11

/** Pass steal: a defender near the lane vs the passer's handling/passing. */
export const PASS_STEAL_BASE = 0.035
export const PASS_STEAL_STAT_WEIGHT = 0.28
/** A defender this close to the pass lane can attempt a deflection. */
export const PASS_LANE_RADIUS = 8

/** On-ball strip while driving into a set defender. Per drive-beat, so kept low
 *  — it compounds over a multi-beat drive to the rim. */
export const STRIP_BASE = 0.05
export const STRIP_STAT_WEIGHT = 0.24

/** Steal-gamble order: reward and the cost of missing (defender out of play). */
export const GAMBLE_STEAL_BASE = 0.18
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
