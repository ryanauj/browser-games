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
// Steps, clock, scoring.
//
// MOVEMENT REWORK (Q10/Q11): the BEAT is gone as the logical atomic unit — the
// STEP is now atomic and the shot clock counts steps. One `RUN_STEP` advances
// exactly one step (turn-based, tap-per-step). A step is ~3.5× finer than the
// old beat, so a possession is ~40-60 steps; magnitudes below are the old
// per-beat values divided by ~3.5 to keep pace roughly constant (tuning is a
// later session — see `pnpm balance`). "Beat" survives only as the render-glide
// duration (BEAT_MS) and the resolution event bus (BeatEvent), not as time.
// ---------------------------------------------------------------------------

/** Real time one step of animation occupies (ms). */
export const BEAT_MS = 420

/** Possession length, counted in STEPS. Expiry = shot-clock turnover. */
export const SHOT_CLOCK_STEPS = 45
/** Shot clock (steps) after an offensive rebound. */
export const SHOT_CLOCK_RESET_OREB = 22

/** First to this many points, win by 2. */
export const WIN_TARGET = 15
export const WIN_BY = 2

// ---------------------------------------------------------------------------
// Movement & stamina — jog (flat) + sprint (accel ramp). See engine.applyMovement.
// ---------------------------------------------------------------------------

/** Base floor units a player covers per STEP at full stamina, before speed.
 *  This is the flat JOG distance (Q4: jog = flat speed, no momentum). */
export const BASE_STEP = 5
/** Speed attribute (0..99) adds up to this many extra units per step to a jog. */
export const SPEED_STEP_BONUS = 3

// --- Sprint accel ramp (Q4/Q12/Q13/Q23) -----------------------------------
// A SPRINT commits a target and accelerates per step toward a top speed along
// the committed line; the per-player current sprint speed lives in serialized
// state (`Player.sprintSpeed`). Jog never builds momentum.
/** Sprint top speed = a player's jog step × this. */
export const SPRINT_TOP_FACTOR = 1.7
/** Per committed sprint step, the fraction of the remaining (top − current) gap
 *  the player closes — the acceleration. Derived from `speed` (Q23: no new attr;
 *  `speed` becomes athleticism = top speed AND ramp rate). A standing start
 *  reaches near top in ~1/ACCEL steps. */
export const ACCEL_BASE = 0.22
export const ACCEL_SPEED = 0.2 // + up to this from speed → quick-twitch ramps sooner

// --- Redirect cost (Q5 angle×speed) + free re-plan (Q24) -------------------
// Any player can be re-steered any step (no hard lock). Bailing a sprint onto a
// new heading pays a penalty that scales with BOTH the turn angle and current
// speed, and resets the accel ramp. A gentle curve is nearly free; a hard cut at
// full speed is brutal (a full-speed sprinter is effectively committed).
/** Fraction of sprint speed shed by a full 180° bail (scaled by the turn angle).
 *  This is the "resets the accel ramp" term (Q24). */
export const REDIRECT_SPEED_LOSS = 0.9
/** Turns gentler than this (radians) are a free sprint curve — no bail cost. */
export const REDIRECT_FREE_ANGLE = 0.25
/** Stamina drained by a full-speed 180° bail; scales by angle×speed (Q26: the
 *  Q5 redirect cost doubles as the stamina tax). */
export const REDIRECT_STAMINA = 6
/** Within this distance (floor units) of the target a mover has ARRIVED: it
 *  holds (Q12, "move to target then hold"), decelerating to a stop (sprint
 *  speed resets) rather than jittering on the spot. */
export const ARRIVE_EPS = 1.5
/** A step that moved less than this counts as a HOLD for stamina (recovers like
 *  idle — Q26 "idle/slow recovers"), regardless of the standing order. */
export const HOLD_EPS = 0.6

/** Stamina drained per STEP by movement mode (Q26). Jog is cheap, sprint drains
 *  (the sprint figure is further scaled by current speed at the call site), a
 *  hold/idle recovers. The Q5 redirect tax (above) is added on a bail. A `pass`
 *  is a one-shot resolved before movement (treated as idle). */
export const STAMINA_COST = {
  idle: -1.8, // negative = recover (hold / stand)
  jog: 1.4,
  sprint: 3.4, // × (sprintSpeed / sprintTop) at the call site
} as const

/** Below this stamina a player is "gassed": slower and worse at everything. */
export const GASSED_THRESHOLD = 22
/** A gassed player's step and contest stats scale by this. */
export const GASSED_FACTOR = 0.62
/** Reach scales continuously with stamina: a fully-drained player still covers
 *  this fraction of their rested reach (100% stamina = full reach). */
export const STAMINA_REACH_MIN = 0.5
/** Below this stamina a player cannot sprint until recovered (degrades to jog). */
export const SPRINT_FLOOR = 10
/** A ball handler who drove into the finish gets this added to their next shot's
 *  make chance — downhill momentum into the finish. Consumed by the shot. */
export const DRIVE_FINISH_BONUS = 0.12

// ---------------------------------------------------------------------------
// Screens. A planted screen bumps any defender who runs through it, sticking
// them for a beat or two and springing their man open.
// ---------------------------------------------------------------------------

/** A defender within this distance of a screener gets caught on the pick. */
export const SCREEN_RADIUS = 10
/** Base STEPS a defender is stuck; strength vs the defender's quickness scales it.
 *  (~old per-beat values × ~3.5 — screens are a deferred action; kept roughly
 *  equivalent so the placeholder AI's picks still register.) */
export const SCREEN_BASE = 3
export const SCREEN_MAX = 6
export const SCREEN_STAT_WEIGHT = 1.6
/** A stuck defender moves at this fraction of their step (slowed/screened). */
export const STUCK_FACTOR = 0.18
/** A screener is freed (back to idle) after this many STEPS if it hasn't hit anyone. */
export const SCREEN_HOLD_MAX = 10

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
export const COLLIDE_MOMENTUM_WEIGHT = 0.18 // per floor-unit of step driven into a body (×4 vs the old beat: steps are ~3.5× shorter)
/** A player setting a screen is a SOLID body: opponents can't move through them,
 *  they must go around (the physical half of a pick). Slightly larger than the
 *  separation gap so the block resolves before separation would. */
export const SCREEN_BODY = 6

// --- Solid-body drive collision --------------------------------------------
// A ball handler driving into a defender is a TRUE collision: he either bulls
// through (shoving the man off his spot and carrying on) or is stopped dead at
// the body — never a phantom that slips past leaving a planted ghost. The
// outcome is strength + the momentum he's carrying vs the defender's anchor; a
// SET defender (one who barely moved this beat) holds far harder. See
// engine.driveCollision. This REPLACES the old slow-through for the driver
// (off-ball cutters still merely get slowed by contestedStep).
/** How close (floor units) the drive path must come to a defender's center to
 *  count as body contact — roughly two torsos. */
export const COLLIDE_RADIUS = 4.5
/** Momentum → bull coupling (Q22): the driver's shove "oomph" reads his tracked
 *  PRE-contact sprint speed directly (`k × sprintSpeed`), on top of his mass.
 *  Replaces the old `COLLIDE_DRIVE_MOMENTUM × stepLen` — a blocked freight-train
 *  drive has its step clipped by contact, so a post-clip length read momentum
 *  LOWEST exactly when it should be highest; the tracked speed fixes that. */
export const COLLIDE_BULL_MOMENTUM = 0.1
/** A fully SET defender (zero motion this step) adds this much to his anchor
 *  mass — enough that a planted man stuffs an even-strength, full-speed drive,
 *  while a defender on the move gives way. */
export const SET_ANCHOR_BONUS = 1.1
/** A defender who moved at least this far this STEP counts as fully "on the
 *  move" (no anchor bonus); below it, the bonus ramps in toward SET_ANCHOR_BONUS.
 *  Tuned to one jog step, so a planted (held) defender anchors and a closing one
 *  does not. */
export const SET_MOTION_REF = 5
/** Most a bulled defender is shoved off his spot in one STEP — bounded so a
 *  collision can't fling a man across the floor; he recovers (re-plans) next step. */
export const COLLIDE_MAX_SHOVE = 3
/** Added on-ball strip chance while the handler's handle is loose from a bull
 *  (the cost of bulling, beyond the stamina it burns). */
export const BULL_STRIP_BONUS = 0.03
/** Extra stamina a bull-through burns (lowering the shoulder is work). */
export const BULL_STAMINA = 4

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
/** …and only count it a drive worth flagging if it meant to travel this far this
 *  STEP, so a short re-position never trips the alarm. */
export const STALL_MIN_DRIVE = 4

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
// Traveling ball (Q18/Q31). A pass launches the ball as an entity that moves a
// set distance per STEP toward its target; a defender whose body falls in the
// travel lane picks it off (positional, Q32 — no dice). See engine.advanceFlight.
// ---------------------------------------------------------------------------

/** Floor units the ball travels per STEP, base + a passer's `passing` bonus —
 *  several times a jog (~5) so the ball clearly outpaces a closeout and a kick
 *  completes in ~2 steps (a catch-and-shoot can survive the recovery). Slower and
 *  a defender always recovers before the catch; far faster and it teleports past
 *  any lane read (Q32). */
export const PASS_SPEED_BASE = 26
export const PASS_SPEED_PASSING = 8
/** A defender whose body is within this of the ball's travel segment (and in its
 *  path) intercepts it (Q32). Just over the AI's own lane-clear threshold (~2.2)
 *  so the placeholder AI threads clean passes, but a man left in the lane in human
 *  play picks it off — steals become a positional read, not a roll. */
export const PASS_INTERCEPT_RADIUS = 2.8
/** The ball is gathered once it comes within this of the receiver (a direct pass
 *  homes onto them, so this is the catch radius). */
export const PASS_CATCH_RADIUS = 4
/** A ball still in flight after this many steps is an errant pass (turnover) — a
 *  safety net so a ball can never loop forever (it should arrive far sooner). */
export const PASS_MAX_STEPS = 12

// ---------------------------------------------------------------------------
// Gather → release shot (Q17/Q33). A shot is a short windup the defense can
// contest during; make%/block are read at release. See engine.runStep gather.
// ---------------------------------------------------------------------------

/** Steps a shot gathers before it releases, before the quick-release relief. */
export const GATHER_BASE = 3
/** A high-`shooting` shooter trims up to this many steps off the gather (quicker
 *  release) — rounded, then clamped to GATHER_MIN. */
export const GATHER_RELIEF = 1
/** Floor on the gather: even a pure shooter takes this many windup steps, so the
 *  defense always gets at least one closeout step. */
export const GATHER_MIN = 2

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

/** Pass steal: a defender near the lane vs the passer's handling/passing. Tuned
 *  down for the drive-and-kick era — the offense swings the ball far more, so a
 *  per-pass rate that was fine at low volume otherwise stacks into a steal spike. */
export const PASS_STEAL_BASE = 0.022
export const PASS_STEAL_STAT_WEIGHT = 0.24
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
