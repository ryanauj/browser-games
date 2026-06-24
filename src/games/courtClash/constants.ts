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

/** Plan-ahead horizon cap (Q45). A possession can't outlast the shot clock, so a
 *  chain can hold at most one queued order per remaining step — `queue.length` is
 *  clamped to this on every write. The precise per-step horizon (orders span many
 *  steps) is deferred tuning; this conservative upper bound keeps the chain
 *  bounded and serialized. */
export const MAX_QUEUE = SHOT_CLOCK_STEPS
/** Safety cap on RUN_UNTIL_HALT iterations (Q44). The loop halts naturally well
 *  inside this (a possession resets to "out of plan", and the shot clock forces a
 *  change within SHOT_CLOCK_STEPS), but a hard ceiling guarantees termination. The
 *  auto-run AND the determinism reference loop both apply it, so they stay
 *  byte-identical. */
export const HALT_STEP_CAP = SHOT_CLOCK_STEPS * 2

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
export const DRIVE_FINISH_BONUS = 0.05

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
/** Planted STEPS (within SCREEN_RADIUS of the spot/marked body) a screener must
 *  hold before the pick is "SET" and legal (Q19). Body contact before this — the
 *  screener still moving INTO the defender — is a moving (illegal) screen. */
export const SCREEN_SET_STEPS = 2
/** Body-contact radius for the pick to actually impede / be a moving screen —
 *  inside the wider SCREEN_RADIUS setup ring, so a screener gets a settling step
 *  in the ring before contact (set it) instead of barrelling straight in (foul). */
export const SCREEN_CONTACT = 6

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
 *  mass — enough that a planted man STUFFS an even-strength, full-speed drive
 *  (the bull becomes a strength/speed-edge play, not the default), while a
 *  defender on the move gives way. Tuned vs the avg full-speed bull push ≈ 2.105
 *  (mass 1.0 + 0.1×sprintTop 11.05): a set avg anchor of 1.0 + 1.3 = 2.30 stops
 *  it, and only a real mass/momentum edge gets through (Q34). */
export const SET_ANCHOR_BONUS = 1.3
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

// --- Committed defensive cutoff (Q9) ---------------------------------------
// The defensive half of the commit/react read-game. When the handler is on a
// committed drive line, the on-ball defender stops trailing (a lost cause vs a
// built-up sprint) and SPRINTS to a spot ahead of the drive to beat him there —
// reusing the offensive sprint machinery (accel ramp + angle×speed bail), then
// planting as the SET body the bull contest favors (engine.driveCollision).
/** Floor units ahead of the handler (along his REVEALED sprint heading) the
 *  cutoff defender targets — ~1.5 sprint steps, far enough to actually get in
 *  front, close enough that the spot stays on the live drive. */
export const CUTOFF_LEAD = 9
/** Only commit the cutoff when the handler's revealed sprint speed clears this —
 *  i.e. he's genuinely downhill on a committed line you can't trail (Q9: cutting
 *  off the spot is for a built-up sprint, NOT every drive). Sprint top ≈ jog×1.7 ≈
 *  8.5–13.6, so this is set just below top speed. 5c (Fix 2): raised 6 → 13. At 6
 *  the cutoff fired on essentially every drive (a building drive clears 6 within a
 *  step), so the on-ball defender abandoned the trail to sprint to a rim plant on
 *  every possession — which FREED the drive lane (the rollout offense then attacked
 *  the rim, dragging the mix rim-ward) and, by feeding the lone planted body bull
 *  contacts, churned drive-strips up to ~10/game. Reserving it for true breakaways
 *  restores the disciplined trailing man (5a containment): the mix returns to
 *  ~62/32 and steals fall into the ~7-9 band. This is what 5b perturbed (Q40). */
export const CUTOFF_SPRINT_MIN = 13
/** The handler's heading must point this much toward the rim (dot of his sprint
 *  heading with the unit-to-rim) for the drive to be a rim threat worth cutting
 *  off — a sprint angled away from the basket isn't an attack to wall. */
export const CUTOFF_RIM_DOT = 0.3

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
 *  a contested one falls off hard — see shotMakeChance. 5d (Fix 3): three 0.25 →
 *  0.28 to buffer realized 3P% against the gather-closeout (a jogging defender
 *  closes out during the 2-step gather, taxing release openness), lifting in-game
 *  3P% from ~25% to a realistic ~34%. The breakaway gate (ai.planOffense) keeps the
 *  open-floor offense finishing at the rim, so this buff lifts the made-rate without
 *  re-tilting open-floor shot selection back to threes. */
export const SHOT_BASE = {
  layup: 0.48,
  two: 0.28,
  three: 0.28,
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

/** On-ball strip while driving into a set defender. Rolled EVERY step the handler
 *  drives within reach of a defender, so it COMPOUNDS over a multi-step drive to the
 *  rim — kept very low per step. 5d (Fix 1): 0.05 → 0.015. The original 0.05 (and
 *  even 0.03) sat at/under the shared clampP 0.03 floor, so the per-step rate was
 *  pinned at 0.03 and STRIP_BASE was inert: it compounded to ~6.7 strips/game (a
 *  ~23%/possession steal rate, ≈3× NBA). The strip now uses its own lower floor
 *  (STRIP_FLOOR) so the base actually controls the compounded composite, landing it
 *  in a realistic ~10–15%/possession band — without killing the read (a contained
 *  drive still risks the ball, preserving the trailing-man strip threat Q40 showed
 *  is what makes the rollout kick out for threes). */
export const STRIP_BASE = 0.022
/** Per-step floor for the on-ball strip (deliberately below clampP's shared 0.03 —
 *  see STRIP_BASE; without this the compounded strip can't be tuned down). */
export const STRIP_FLOOR = 0.010
export const STRIP_STAT_WEIGHT = 0.24

/** Steal-gamble order (Q20): a defender lunges for the strip. Base reward + a big
 *  bonus vs a LOOSE handle (a handler whose ball is exposed from bulling a body,
 *  `Player.bull`), composed with the collision output rather than re-derived. */
export const GAMBLE_STEAL_BASE = 0.1 // 5c (Fix 1): 0.18 → 0.10, see GAMBLE_STEAL_LOOSE_BONUS
export const GAMBLE_STEAL_STAT_WEIGHT = 0.3
/** Added to the gamble vs a loose/bulled handle — the strip is far likelier when
 *  the ball is already exposed. 5c (Fix 1): trimmed 0.24 → 0.16 — against the
 *  rollout offense the loose-handle gamble was the single biggest steal source
 *  (~7/game of the 16.8 spike); a missed reach-in is meant to be a real risk, not
 *  the dominant way the ball changes hands. */
export const GAMBLE_STEAL_LOOSE_BONUS = 0.16
/** Cost of a MISSED gamble (Q20): the defender lunged and got beaten. He
 *  over-commits this many floor units toward where the ball was (out of the play)…
 */
export const GAMBLE_MISS_LUNGE = 4
/** …and is slowed (STUCK) this many steps recovering — handing the offense a real
 *  step of separation for the failed reach-in. */
export const GAMBLE_MISS_STUCK = 3
/** Pre-movement range (floor units) within which a defender will issue the gamble
 *  on a loose handle. A touch beyond the engine's post-movement gamble reach (≤8)
 *  so a defender who closes a step this beat still arrives in strip range; kept
 *  tight so only a defender already on the ball lunges (the loose handle is a
 *  one-step window, not a standing reach-in). */
export const GAMBLE_RANGE = 10
/** A loose-handle handler is only worth gambling on once he's bulled this close to
 *  the rim — a near-certain finish where a missed reach-in costs ~nothing (he was
 *  scoring anyway) but a strip denies the bucket. Farther out, a contained drive is
 *  worth more kept in front than coin-flipped away, so the defender holds. 5c
 *  (Fix 1): tightened RIM_RADIUS+8 → RIM_RADIUS−4 (≈10 units, essentially at the
 *  basket). Against the rollout offense the wider band fired the gamble on
 *  essentially every bulled drive — it not only spiked steals but, by pulling the
 *  on-ball man into a lunge, vacated containment and dragged the shot mix to the
 *  rim. The gate is a cliff: at RIM−3 self-play steals jump to ~15 (the gamble
 *  fires all the way up a contained drive); RIM−4 sits on the stable plateau
 *  (~7 steals) where it stays a real read on a true loose handle at the basket
 *  without churning possessions. */
export const GAMBLE_THREAT_RIM = RIM_RADIUS - 4

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
