import {
  ARRIVE_EPS,
  BASKET,
  BLOCK_BASE_PERIMETER,
  BLOCK_BASE_RIM,
  BLOCK_STAT_WEIGHT,
  BULL_STAMINA,
  BULL_STRIP_BONUS,
  COLLIDE_BULL_MOMENTUM,
  COLLIDE_MASS_STRENGTH,
  COLLIDE_MAX_SHOVE,
  COLLIDE_MOMENTUM_WEIGHT,
  COLLIDE_RADIUS,
  CONTEST_RADIUS,
  DRIVE_FINISH_BONUS,
  GAMBLE_STEAL_BASE,
  GAMBLE_STEAL_STAT_WEIGHT,
  GASSED_THRESHOLD,
  HOLD_EPS,
  LEAD_CATCH_RADIUS,
  OPENNESS_SHOT_WEIGHT,
  OREB_BASE,
  PASS_LANE_RADIUS,
  PASS_STEAL_BASE,
  PASS_STEAL_STAT_WEIGHT,
  REDIRECT_FREE_ANGLE,
  REDIRECT_SPEED_LOSS,
  REDIRECT_STAMINA,
  SCREEN_BASE,
  SCREEN_BODY,
  SCREEN_HOLD_MAX,
  SCREEN_MAX,
  SCREEN_RADIUS,
  SEPARATION_MIN,
  SET_ANCHOR_BONUS,
  SET_MOTION_REF,
  SHOT_BASE,
  SHOT_CLOCK_RESET_OREB,
  SHOT_CLOCK_STEPS,
  SHOT_STAT_WEIGHT,
  SPRINT_FLOOR,
  STALL_KEPT_FRACTION,
  STALL_MIN_DRIVE,
  STAMINA_COST,
  STRIP_BASE,
  STRIP_STAT_WEIGHT,
  STUCK_FACTOR,
  THREE_PT_RADIUS,
  WIN_BY,
  WIN_TARGET,
} from './constants'
import {
  accelFracOf,
  angleBetween,
  clampToCourt,
  contestedStep,
  dist,
  distToRim,
  distToSegment,
  openness,
  opponentOf,
  rangePenalty,
  reachOf,
  shotPoints,
  shotType,
  sprintTopOf,
  stepToward,
  teammates,
  unitTo,
} from './geometry'
import { aiPlan } from './ai'
import { ARCHETYPES, buildPlayers } from './roster'
import { nextRandom } from './rng'
import type { Action, BeatEvent, GameState, Order, Player, Side, Vec } from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createInitialState(seed: number = Date.now()): GameState {
  const players = buildPlayers()
  const base: GameState = {
    phase: 'play',
    players,
    ballHandlerId: null,
    ball: null,
    gather: null,
    offense: 'player',
    shotClock: SHOT_CLOCK_STEPS,
    score: { player: 0, ai: 0 },
    possession: 0,
    step: 0,
    winTarget: WIN_TARGET,
    seed: seed | 0,
    rngState: seed | 0,
    events: [],
    log: ['Tip-off — your ball.'],
  }
  return setupPossession(base, 'player', SHOT_CLOCK_STEPS, base.log)
}

/** Position both fives for a fresh possession: offense at home spots, defense
 *  man-up goal-side, ball to the offense's point guard. */
function setupPossession(
  state: GameState,
  offense: Side,
  clock: number,
  log: string[],
): GameState {
  const players = state.players.map((p) => ({
    ...p,
    pos: { ...p.pos },
    sprintSpeed: 0,
    sprintDir: null,
    stuck: 0,
    screenHeld: 0,
    primed: 0,
    bull: 0,
  }))
  const off = players.filter((p) => p.side === offense)
  const def = players.filter((p) => p.side !== offense)

  off.forEach((p, i) => {
    p.pos = { ...ARCHETYPES[i].spot }
    p.order = { kind: 'idle' }
    p.stamina = Math.min(100, p.stamina + 14) // catch your breath at the check
  })
  // Defenders line up goal-side of their man (same archetype index = matchup).
  def.forEach((p, i) => {
    const mark = off[i]
    p.pos = clampToCourt(stepToward(mark.pos, BASKET, 9))
    p.order = { kind: 'guard', markId: mark.id }
    p.stamina = Math.min(100, p.stamina + 14)
  })

  return {
    ...state,
    players,
    offense,
    ballHandlerId: off[0].id,
    ball: null, // a fresh possession clears any in-flight ball / windup
    gather: null,
    shotClock: clock,
    possession: state.possession + 1,
    events: state.events.length ? state.events : [],
    log,
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const byId = (players: Player[], id: string | null): Player | undefined =>
  id == null ? undefined : players.find((p) => p.id === id)

const clampP = (p: number): number => Math.max(0.03, Math.min(0.97, p))
const isGassed = (p: Player): boolean => p.stamina < GASSED_THRESHOLD
const statN = (v: number): number => (v - 50) / 49 // ~[-1,1]

/** The movement MODE an order travels at (Q13). Sprint commits a line and builds
 *  momentum; jog is flat and reactive; null = no travel (idle / one-shot pass).
 *  `drive`/`cut` are sprint specializations (they carry their own action
 *  semantics — collision/strip/prime, off-ball cut). Defensive tracking orders
 *  (guard/double/help/steal) and the screener move at a reactive jog — a
 *  committed defensive sprint (cut off the spot, Q9) is later AI work (Q25). */
function moveModeOf(o: Order): 'jog' | 'sprint' | null {
  switch (o.kind) {
    case 'idle':
    case 'pass':
      return null
    case 'drive':
    case 'cut':
      return 'sprint'
    case 'move':
      return o.mode === 'sprint' ? 'sprint' : 'jog'
    default:
      return 'jog'
  }
}

function pushLog(log: string[], line: string): string[] {
  return [line, ...log].slice(0, 8)
}

function sideName(side: Side): string {
  return side === 'player' ? 'You' : 'CPU'
}

// ---------------------------------------------------------------------------
// Movement — apply one beat of motion per each player's standing order.
// ---------------------------------------------------------------------------

function targetFor(p: Player, players: Player[], ballHandler: Player | undefined): Vec | null {
  switch (p.order.kind) {
    case 'idle':
    case 'pass':
      return null
    case 'move':
    case 'cut':
    case 'drive':
    case 'help':
      return p.order.to
    case 'screen': {
      // A body-targeted screen tracks the defender each beat (so the pick lands
      // on a moving man, not a patch of floor); otherwise it's a fixed spot.
      if (p.order.markId) {
        const mark = byId(players, p.order.markId)
        if (mark) return { ...mark.pos }
      }
      return p.order.to
    }
    case 'guard': {
      const mark = byId(players, p.order.markId)
      return mark ? stepToward(mark.pos, BASKET, 9) : null
    }
    case 'steal': {
      const mark = byId(players, p.order.markId)
      return mark ? { ...mark.pos } : null
    }
    case 'double':
      return ballHandler ? { ...ballHandler.pos } : null
  }
}

/** Resolve planted screens: a defender who runs through a screener gets stuck
 *  for a beat or two (scaled by the screener's strength vs the defender's
 *  quickness), springing their man. The screener is freed once it connects or
 *  after SCREEN_HOLD_MAX beats. Runs before movement so the slow takes hold. */
function resolveScreens(players: Player[]): void {
  for (const s of players) {
    if (s.order.kind !== 'screen') continue
    // The pick sets where the screener is headed: a tracked defender (body) or a
    // fixed spot. Don't set it until the screener has actually planted there —
    // otherwise it would instantly "screen" whoever happens to be adjacent
    // (often its own defender) and free itself before ever travelling.
    const tracked = s.order.markId ? byId(players, s.order.markId) : undefined
    const targetPos = tracked ? tracked.pos : s.order.to
    const planted = dist(s.pos, targetPos) <= SCREEN_RADIUS
    if (!planted) continue
    s.screenHeld += 1
    let connected = false
    for (const d of players) {
      if (d.side === s.side) continue
      if (dist(d.pos, s.pos) > SCREEN_RADIUS) continue
      // The screener's own man is behind the pick — a screen springs a teammate
      // by impeding *their* defender, not the one already guarding the screener.
      const guardsScreener =
        (d.order.kind === 'guard' || d.order.kind === 'double' || d.order.kind === 'steal') &&
        d.order.markId === s.id
      if (guardsScreener) continue
      // A clean connect always sticks for SCREEN_BASE beats; a strong screener
      // against a less-quick defender holds them an extra beat (up to SCREEN_MAX).
      const quickness = (d.attr.speed + d.attr.perimeterD) / 2
      const advantage = statN(s.attr.strength) - statN(quickness)
      const dur = advantage > 0.15 ? SCREEN_MAX : SCREEN_BASE
      d.stuck = Math.max(d.stuck, dur)
      connected = true
    }
    if (connected || s.screenHeld >= SCREEN_HOLD_MAX) {
      s.order = { kind: 'idle' }
      s.screenHeld = 0
    }
  }
}

/** Clamp a move so it can't pass through a solid body: if the path from→to
 *  enters within `radius` of any blocker, stop at the body's edge. Movers that
 *  start already inside a blocker's radius aren't trapped (so they can step out). */
function blockedStep(from: Vec, to: Vec, blockers: Player[], radius: number): Vec {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return to
  let bestT = 1
  for (const b of blockers) {
    const fx = from.x - b.pos.x
    const fy = from.y - b.pos.y
    const c = fx * fx + fy * fy - radius * radius
    if (c <= 0) continue // already inside this body — don't trap the mover
    const bb = 2 * (fx * dx + fy * dy)
    const disc = bb * bb - 4 * len2 * c
    if (disc < 0) continue
    const t = (-bb - Math.sqrt(disc)) / (2 * len2) // earliest entry into the body
    if (t >= 0 && t < bestT) bestT = t
  }
  return bestT >= 1 ? to : { x: from.x + dx * bestT, y: from.y + dy * bestT }
}

/** A body's "mass" for shoving: strength swings it around 1.0. */
function shoveMass(p: Player): number {
  return 1 + COLLIDE_MASS_STRENGTH * statN(p.attr.strength)
}

/** Resolve overlaps so no two players (either team, ball handler included) end a
 *  beat stacked. Not a wall and not an even split: it's a shove. Each body's
 *  "oomph" is its mass (strength) plus how hard it drove INTO the contact this
 *  beat (momentum), and the loser gives way in proportion — a strong, downhill
 *  driver moves a planted defender off their spot; a backpedaling one gets
 *  bumped. Deterministic (fixed order + fixed momentum), so replays stay exact. */
function separateBodies(players: Player[], before: Map<string, Vec>): void {
  // Momentum = the step each body actually took this beat (captured pre-shove).
  const mom = new Map(
    players.map((p) => {
      const b = before.get(p.id)
      return [p.id, b ? { x: p.pos.x - b.x, y: p.pos.y - b.y } : { x: 0, y: 0 }] as const
    }),
  )
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]
        const b = players[j]
        const dx = b.pos.x - a.pos.x
        const dy = b.pos.y - a.pos.y
        let d = Math.hypot(dx, dy)
        if (d >= SEPARATION_MIN) continue
        // Unit axis a→b; coincident bodies use a fixed axis so replay stays exact.
        const ux = d < 1e-6 ? 1 : dx / d
        const uy = d < 1e-6 ? 0 : dy / d
        // Oomph: mass + momentum driven into the other body (only the component
        // pushing toward contact counts — backing away doesn't shove).
        const ma = mom.get(a.id)!
        const mb = mom.get(b.id)!
        const wa = shoveMass(a) + COLLIDE_MOMENTUM_WEIGHT * Math.max(0, ma.x * ux + ma.y * uy)
        const wb = shoveMass(b) + COLLIDE_MOMENTUM_WEIGHT * Math.max(0, mb.x * -ux + mb.y * -uy)
        const corr = SEPARATION_MIN - d
        // The heavier/faster body holds ground; the other gives way more.
        const pushA = corr * (wb / (wa + wb))
        const pushB = corr * (wa / (wa + wb))
        a.pos = clampToCourt({ x: a.pos.x - ux * pushA, y: a.pos.y - uy * pushA })
        b.pos = clampToCourt({ x: b.pos.x + ux * pushB, y: b.pos.y + uy * pushB })
      }
    }
  }
}

/** Solid-body drive collision. A ball handler driving into a defender either
 *  BULLS THROUGH — shoving the man off his spot and carrying on — or is STOPPED
 *  dead at the body. He never phantoms past leaving a planted ghost (the old
 *  bug). The contest is the driver's mass + the momentum he's carrying into the
 *  hit vs the defender's anchor; a SET defender (one who barely moved this beat)
 *  holds far harder, so a planted man can stuff an even-strength, full-speed
 *  drive while a defender on the move gives way. Does NOT mutate the defender:
 *  it RETURNS the shove (id + displacement, bounded by COLLIDE_MAX_SHOVE) so the
 *  two-phase resolver applies it on TOP of the defender's own planned jog — the
 *  jog is kept regardless of ball side (the order-independence fix; the old
 *  in-loop mutation overwrote the jog when the defender was iterated before the
 *  driver, i.e. AI-on-offense). `defMove` maps each defender id to how far it
 *  intends to move this step. Returns where the driver ends up, whether he
 *  bulled (loose handle), and the shove to apply (null if stopped / path clear). */
function driveCollision(
  driver: Player,
  from: Vec,
  want: Vec,
  defenders: Player[],
  defStart: Map<string, Vec>,
  defMove: Map<string, number>,
): { pos: Vec; bull: boolean; shove: { id: string; vec: Vec } | null } {
  const dx = want.x - from.x
  const dy = want.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { pos: want, bull: false, shove: null }
  const ux = dx / len
  const uy = dy / len
  // Earliest body the straight path enters (ray vs a COLLIDE_RADIUS disc).
  let hit: Player | null = null
  let hitT = Infinity
  for (const d of defenders) {
    const dp = defStart.get(d.id) ?? d.pos
    const t = (dp.x - from.x) * ux + (dp.y - from.y) * uy
    if (t <= 0 || t - COLLIDE_RADIUS > len) continue // behind, or out of reach
    const perp = Math.hypot(from.x + ux * t - dp.x, from.y + uy * t - dp.y)
    if (perp >= COLLIDE_RADIUS) continue // path clears this body
    const entry = t - Math.sqrt(Math.max(0, COLLIDE_RADIUS * COLLIDE_RADIUS - perp * perp))
    if (entry < hitT) {
      hitT = entry
      hit = d
    }
  }
  if (!hit) return { pos: want, bull: false, shove: null }

  // The shove contest at the body. Momentum = the driver's tracked PRE-contact
  // sprint speed (Q22) — the Q4 accel ramp flows straight into the hit: a long
  // committed runway is a heavy bull, a standing/cutting man a light one.
  const driverPush = shoveMass(driver) + COLLIDE_BULL_MOMENTUM * driver.sprintSpeed
  const setFactor = Math.max(0, Math.min(1, 1 - (defMove.get(hit.id) ?? 0) / SET_MOTION_REF))
  const defAnchor = shoveMass(hit) + SET_ANCHOR_BONUS * setFactor

  if (driverPush <= defAnchor) {
    // STOPPED: pull up just shy of the body — no phantom through.
    const stop = Math.max(0, hitT - 0.1)
    return { pos: { x: from.x + ux * stop, y: from.y + uy * stop }, bull: false, shove: null }
  }

  // BULL THROUGH: the driver carries to his spot and knocks the man off his.
  // Shove the defender along the contact normal (the way the drive is going),
  // scaled by how decisively the drive won, capped so no one gets launched. The
  // shove is returned as a DISPLACEMENT (not written to defStart+shove): the
  // resolver adds it to the defender's own planned jog, so his jog survives the
  // hit no matter which side iterated first.
  const margin = Math.min(1, (driverPush - defAnchor) / Math.max(0.5, defAnchor))
  const shove = COLLIDE_MAX_SHOVE * (0.5 + 0.5 * margin)
  return { pos: want, bull: true, shove: { id: hit.id, vec: { x: ux * shove, y: uy * shove } } }
}

/** Floor units a player would travel toward its target THIS step, read purely
 *  from start-of-step state (so it's order-independent and replay-exact). Sprint
 *  uses the current tracked speed (pre-ramp) as a proxy. Used only to tell a SET
 *  defender (anchored, ~0 motion) from one on the move for the bull anchor. */
function intendedStepLen(p: Player, target: Vec | null): number {
  if (!target) return 0
  const mode = moveModeOf(p.order)
  if (mode === null) return 0
  let step = mode === 'sprint' ? Math.max(reachOf(p), p.sprintSpeed) : reachOf(p)
  if (p.stuck > 0) step *= STUCK_FACTOR
  return dist(p.pos, stepToward(p.pos, target, step))
}

/** Advance one STEP of motion, in TWO PHASES so the result is order-independent
 *  — it can't depend on array iteration order or which side holds the ball (so
 *  the Q16/Q25 simultaneous rollout can trust it):
 *
 *    PHASE 1 — PLAN. From the start-of-step snapshot (`before`), compute every
 *      player's intended next position (accel/jog/redirect per Q4/Q5) reading
 *      ONLY `before`. No position is committed here, so every target/heading is
 *      read off the revealed (last-step) state — a built-in 1-step read lag,
 *      consistent with Q16's simultaneous resolution.
 *    PHASE 2 — RESOLVE. Resolve contacts (the driver's bull-shove, off-ball
 *      `contestedStep` slow-down) against that planned buffer, still reading
 *      every OTHER body from `before` (nothing is committed until the phase ends).
 *      A bulled defender's shove is applied ON TOP of his own planned jog, so his
 *      jog is kept whether the driver or the defender came first in the array —
 *      the home-side asymmetry the old single-pass loop had (jog compounded when
 *      the player drove, discarded when the AI drove) is gone.
 *
 *  TIE-BREAK (two players contesting the same spot): movers plan independently
 *  from `before`, so two can plan into the same cell; the overlap is then broken
 *  by `separateBodies`, which iterates the FIXED roster order [player-0..4,
 *  ai-0..4] with the strength+momentum shove math and a fixed +x axis for exactly
 *  coincident bodies. That order is the same regardless of which side is on
 *  offense, so the same configuration resolves identically on either ball-side.
 *
 *  JOG = flat reach, no momentum (Q4). SPRINT accelerates per step toward a top
 *  speed (Q4 ramp, tracked in `sprintSpeed`); bailing onto a new heading pays an
 *  angle×speed penalty and resets the ramp (Q5/Q24). Stamina is per-mode (Q26):
 *  jog cheap, sprint drains (∝ speed), a hold recovers, plus the Q5 bail tax. */
export function applyMovement(
  players: Player[],
  ballHandlerId: string | null,
  offense?: Side,
): { handlerStalled: boolean } {
  const ballHandler = byId(players, ballHandlerId)
  // Which side is on offense. Prefer the explicit `offense` (valid even when the
  // ball is in flight and `ballHandlerId` is null); fall back to the handler's
  // side so the order-dep probe's 2-arg call keeps its old behavior.
  const offSide: Side | null = offense ?? ballHandler?.side ?? null
  // Opponents setting a screen are solid bodies you must go around, not through.
  const screeners = players.filter((s) => s.order.kind === 'screen')
  // Start-of-step snapshot. EVERY read below — targets, screener bodies, the bull
  // ray, the off-ball contest — comes from `before`; no player's position is
  // committed until the whole step is resolved, so nothing depends on iteration
  // order or ball-side. (During both phases each `p.pos` still equals `before`.)
  const before = new Map(players.map((p) => [p.id, { ...p.pos }]))
  const intendedMove = new Map<string, number>()
  for (const p of players) intendedMove.set(p.id, intendedStepLen(p, targetFor(p, players, ballHandler)))

  // ---- PHASE 1: PLAN. Intended next position + the stamina mode/bail-tax to
  //      charge, per player, all from `before`. Mutates only per-player movement
  //      STATE (sprintSpeed/sprintDir/order/primed) — never a position.
  const planned = new Map<string, Vec>()
  const planMode = new Map<string, 'jog' | 'sprint' | null>()
  const planTax = new Map<string, number>()
  for (const p of players) {
    let mode = moveModeOf(p.order)
    // Sprint floor: too gassed to sprint. A drive/cut collapses to idle (no
    // explosive verb when spent); a sprint-move degrades to a flat jog.
    if (mode === 'sprint' && p.stamina < SPRINT_FLOOR) {
      if (p.order.kind === 'drive' || p.order.kind === 'cut') {
        p.order = { kind: 'idle' }
        mode = null
      } else {
        mode = 'jog'
      }
    }
    if (p.order.kind === 'drive') p.primed = 1 // a drive primes the next shot's finish

    const target = targetFor(p, players, ballHandler)
    const heading = target ? unitTo(p.pos, target) : null
    const arrived = target ? dist(p.pos, target) <= ARRIVE_EPS : true

    // Decide this step's travel distance + update the accel/redirect state.
    let step = 0
    let redirectTax = 0
    if (mode === null || !target || !heading || arrived) {
      // Idle / one-shot / arrived → HOLD: decelerate to a stop (ramp resets).
      p.sprintSpeed = 0
      p.sprintDir = null
    } else if (mode === 'sprint') {
      const top = sprintTopOf(p)
      // Bail cost (Q5 angle×speed): a turn off the committed heading sheds speed
      // (resets the ramp ∝ turn, Q24) and taxes stamina (∝ angle×speed, Q26).
      if (p.sprintSpeed > 0 && p.sprintDir) {
        const ang = angleBetween(p.sprintDir, heading)
        if (ang > REDIRECT_FREE_ANGLE) {
          const turn = Math.min(1, ang / Math.PI)
          redirectTax = REDIRECT_STAMINA * turn * (p.sprintSpeed / top)
          p.sprintSpeed *= 1 - REDIRECT_SPEED_LOSS * turn
        }
      }
      // (Re)start at no less than a jog, then accelerate toward the top (Q4).
      const jog = reachOf(p)
      if (p.sprintSpeed < jog) p.sprintSpeed = jog
      p.sprintSpeed = Math.min(top, p.sprintSpeed + (top - p.sprintSpeed) * accelFracOf(p))
      p.sprintDir = { ...heading }
      step = p.sprintSpeed
    } else {
      // Jog: flat, reactive, no momentum (Q4). Re-aiming is free.
      p.sprintSpeed = 0
      p.sprintDir = null
      step = reachOf(p)
    }
    if (p.stuck > 0) step *= STUCK_FACTOR // hung up on a screen (decayed at step start)

    let want = { ...before.get(p.id)! } // no travel → hold at the start-of-step spot
    if (target && step > 0) {
      const raw = stepToward(p.pos, target, step)
      // Can't run through a planted screener — go around (the physical pick).
      const blockers = screeners.filter((s) => s.side !== p.side && s.id !== p.id)
      want = clampToCourt(blockedStep(p.pos, raw, blockers, SCREEN_BODY))
    }
    planned.set(p.id, want)
    planMode.set(p.id, mode)
    planTax.set(p.id, redirectTax)
  }

  // ---- PHASE 2: RESOLVE. Contacts against the planned buffer, every other body
  //      still read from `before`. Driver bulls/stops; off-ball movers are slowed
  //      by bodies in their lane. Bull shoves are recorded, then applied AFTER on
  //      top of the bulled defender's own planned jog (kept on either ball-side).
  const resolved = new Map<string, Vec>()
  const shoves: { id: string; vec: Vec }[] = []
  let handlerStalled = false
  for (const p of players) {
    const want = planned.get(p.id)!
    let next = want
    if (p.id === ballHandlerId && p.order.kind === 'drive') {
      // The DRIVER is a solid body meeting solid bodies: bull through (shove the
      // man off his spot, fed by his PRE-contact sprint speed) or get stopped
      // dead — never slip through. Defenders read from `before` (their start-of-
      // step spots) so resolution is order-independent and replays stay exact.
      const bodies = players.filter((o) => o.side !== p.side && o.id !== p.id && o.order.kind !== 'screen')
      const { pos, bull, shove } = driveCollision(p, before.get(p.id)!, want, bodies, before, intendedMove)
      const settled = clampToCourt(pos)
      const intended = dist(before.get(p.id)!, want)
      const kept = dist(before.get(p.id)!, settled)
      if (!bull && intended >= STALL_MIN_DRIVE && kept < intended * STALL_KEPT_FRACTION) handlerStalled = true
      if (bull) p.bull = 1 // loose handle (strip risk) + extra legs, charged below
      if (shove) shoves.push(shove)
      next = settled
    } else if (offSide && p.side === offSide) {
      // Off-ball offensive movers (cutters, relocations) are merely SLOWED by
      // bodies in their lane — they don't bull, and they don't tunnel through.
      // Opponent bodies are read from `before` (each `o.pos` still equals its
      // start-of-step spot here), so a later-iterated mover sees the SAME floor an
      // earlier one does — the old live-position read (engine bug) is gone.
      const bodies = players.filter((o) => o.side !== p.side && o.id !== p.id && o.order.kind !== 'screen')
      next = clampToCourt(contestedStep(before.get(p.id)!, want, bodies, p.attr.strength))
    }
    resolved.set(p.id, next)
  }
  // Apply each bull shove on top of the bulled defender's resolved (planned-jog)
  // spot — additive, so his jog survives the hit no matter the iteration order.
  for (const { id, vec } of shoves) {
    const r = resolved.get(id)!
    resolved.set(id, clampToCourt({ x: r.x + vec.x, y: r.y + vec.y }))
  }
  // Commit positions — only now, after every read above saw `before`.
  for (const p of players) p.pos = resolved.get(p.id)!

  // Stamina (Q26): a step that barely moved recovers like idle; otherwise pay the
  // mode cost (sprint scaled by current speed) plus any bail tax and bull.
  for (const p of players) {
    const moved = dist(before.get(p.id)!, p.pos)
    const mode = planMode.get(p.id)
    const staKey = moved < HOLD_EPS ? 'idle' : mode === 'sprint' ? 'sprint' : 'jog'
    let cost = STAMINA_COST[staKey]
    if (staKey === 'sprint') cost *= p.sprintSpeed / sprintTopOf(p)
    cost += (planTax.get(p.id) ?? 0) + (p.bull > 0 ? BULL_STAMINA : 0)
    p.stamina = Math.max(0, Math.min(100, p.stamina - cost))
  }
  // No two bodies end a step stacked — resolved as a strength/momentum shove in
  // the fixed roster order (the documented, side-symmetric tie-break above).
  separateBodies(players, before)
  return { handlerStalled }
}

// ---------------------------------------------------------------------------
// Resolution model (exported so the UI can render the risk glow live).
// ---------------------------------------------------------------------------

export function passStealChance(
  players: Player[],
  passer: Player,
  target: Player,
): { p: number; thief: Player | null } {
  let thief: Player | null = null
  let best = 0
  for (const d of players) {
    if (d.side === passer.side) continue
    const laneD = distToSegment(d.pos, passer.pos, target.pos)
    if (laneD > PASS_LANE_RADIUS) continue
    const proximity = 1 - laneD / PASS_LANE_RADIUS
    const p = clampP(
      PASS_STEAL_BASE +
        proximity * 0.12 +
        (statN(d.attr.perimeterD) - statN(passer.attr.passing)) * PASS_STEAL_STAT_WEIGHT,
    )
    if (p > best) {
      best = p
      thief = d
    }
  }
  return { p: best, thief }
}

export function blockChance(players: Player[], shooter: Player): { p: number; blocker: Player | null } {
  let blocker: Player | null = null
  let bestDist = Infinity
  for (const d of players) {
    if (d.side === shooter.side) continue
    const dd = dist(d.pos, shooter.pos)
    if (dd < bestDist && dd <= CONTEST_RADIUS) {
      bestDist = dd
      blocker = d
    }
  }
  if (!blocker) return { p: 0, blocker: null }
  const rimCloseness = 1 - Math.min(1, distToRim(shooter.pos) / THREE_PT_RADIUS)
  const base = BLOCK_BASE_PERIMETER + (BLOCK_BASE_RIM - BLOCK_BASE_PERIMETER) * rimCloseness
  const proximity = 1 - bestDist / CONTEST_RADIUS
  const p = clampP(base * (0.4 + 0.6 * proximity) + statN(blocker.attr.interiorD) * BLOCK_STAT_WEIGHT)
  return { p, blocker }
}

/** Probability a called shot goes in (pre-block). Openness dominates. */
export function shotMakeChance(players: Player[], shooter: Player): number {
  const type = shotType(shooter.pos)
  const base = SHOT_BASE[type]
  const open = openness(players, shooter)
  const skill = type === 'layup' ? shooter.attr.finishing : shooter.attr.shooting
  const p =
    base +
    OPENNESS_SHOT_WEIGHT * (open - 0.4) +
    statN(skill) * SHOT_STAT_WEIGHT -
    rangePenalty(shooter.pos) * 0.45 -
    (isGassed(shooter) ? 0.08 : 0) +
    (shooter.primed > 0 ? DRIVE_FINISH_BONUS : 0) // downhill off a drive
  return clampP(p)
}

// ---------------------------------------------------------------------------
// RNG helper threaded through the pure reducer.
// ---------------------------------------------------------------------------

class Roll {
  private s: number
  constructor(seed: number) {
    this.s = seed
  }
  rand(): number {
    const [v, n] = nextRandom(this.s)
    this.s = n
    return v
  }
  roll(p: number): boolean {
    return this.rand() < p
  }
  get next(): number {
    return this.s
  }
}

// ---------------------------------------------------------------------------
// Shot & beat resolution
// ---------------------------------------------------------------------------

function resolveShot(state: GameState, shooterId: string): GameState {
  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  const shooter = byId(players, shooterId)
  if (!shooter || state.phase === 'gameover') return state
  const r = new Roll(state.rngState)
  const events: BeatEvent[] = []
  let log = state.log
  const off = shooter.side
  const def = opponentOf(off)
  const pts = shotPoints(shooter.pos)

  const { p: blockP, blocker } = blockChance(players, shooter)
  if (blocker && r.roll(blockP)) {
    events.push({ kind: 'block', by: blocker.id, from: shooter.pos, text: `${blocker.name} BLOCKS it!` })
    log = pushLog(log, `🚫 ${blocker.name} rejects ${shooter.name}.`)
    return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_STEPS, log)
  }

  const makeP = shotMakeChance(players, shooter)
  if (r.roll(makeP)) {
    const score = { ...state.score, [off]: state.score[off] + pts }
    events.push({ kind: 'shotMake', by: shooter.id, from: shooter.pos, to: BASKET, points: pts, text: `${pts}!` })
    log = pushLog(log, `🏀 ${shooter.name} hits a ${pts}. ${score.player}–${score.ai}`)
    if (score[off] >= WIN_TARGET && score[off] - score[def] >= WIN_BY) {
      return {
        ...state,
        players,
        rngState: r.next,
        score,
        events,
        log: pushLog(log, `🏆 ${sideName(off)} win!`),
        phase: 'gameover',
        winner: off,
      }
    }
    return setupPossession({ ...state, players, rngState: r.next, score, events, log }, def, SHOT_CLOCK_STEPS, log)
  }

  // Miss → rebound contest.
  events.push({ kind: 'shotMiss', by: shooter.id, from: shooter.pos, to: BASKET, text: 'Off the iron' })
  const orebStrength =
    OREB_BASE +
    statN(Math.max(...teammates(players, off).map((t) => t.attr.strength))) * 0.18 -
    statN(Math.max(...teammates(players, def).map((t) => t.attr.strength))) * 0.12
  if (r.roll(clampP(orebStrength))) {
    const crasher = teammates(players, off).reduce((a, b) => (distToRim(a.pos) < distToRim(b.pos) ? a : b))
    events.push({ kind: 'rebound', by: crasher.id, from: BASKET, to: { ...crasher.pos }, text: `${crasher.name} — offensive board!` })
    log = pushLog(log, `↩️ ${crasher.name} grabs the offensive rebound.`)
    return {
      ...state,
      players,
      rngState: r.next,
      ballHandlerId: crasher.id,
      shotClock: SHOT_CLOCK_RESET_OREB,
      events,
      log,
    }
  }
  const grabber = teammates(players, def).reduce((a, b) => (distToRim(a.pos) < distToRim(b.pos) ? a : b))
  events.push({ kind: 'rebound', by: grabber.id, from: BASKET, to: { ...grabber.pos }, text: `${grabber.name} rebounds.` })
  log = pushLog(log, `🔁 ${grabber.name} grabs the board — ${sideName(def)} ball.`)
  return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_STEPS, log)
}

/** Advance one STEP of motion: decay screen/drive timers, resolve planted
 *  screens, then move every player along their standing order. Mutates players.
 *  Returns whether the ball handler's drive was throttled by traffic this step. */
function advanceMotion(
  players: Player[],
  ballHandlerId: string | null,
  offense: Side,
): { handlerStalled: boolean } {
  for (const p of players) {
    if (p.stuck > 0) p.stuck -= 1
    if (p.primed > 0) p.primed -= 1 // a finishing boost expires if no shot followed
    p.bull = 0 // loose handle is recomputed each step by the collision
  }
  resolveScreens(players)
  return applyMovement(players, ballHandlerId, offense)
}

function runStep(state: GameState): GameState {
  if (state.phase === 'gameover') return state

  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  const r = new Roll(state.rngState)
  let events: BeatEvent[] = []
  let log = state.log

  // 1. The CPU floor general sets its five's orders (and may commit to a shot).
  //    SIMULTANEOUS RESOLUTION (Q16): the AI decides from the REVEALED (last-step)
  //    positional state only — it never reads the human's order committed this
  //    step (the placeholder aiPlan reads positions/stamina, not opponent orders).
  //    The opponent's orders persist from the human/standing orders.
  const plan = aiPlan({ ...state, players })
  for (const o of plan.orders) {
    const p = byId(players, o.playerId)
    if (p) p.order = o.order
  }

  // 2. MOVEMENT FIRST: everyone moves this beat — including the defense's
  //    closeouts and rotations — BEFORE any contest resolves. This is what makes
  //    defense matter: a shot/pass/drive is judged against where defenders end
  //    up, not where they started.
  const { handlerStalled } = advanceMotion(players, state.ballHandlerId, state.offense)

  const handler = byId(players, state.ballHandlerId)

  // 3. A committed CPU shot resolves against the post-movement floor — but the
  //    CPU re-reads the look after the defense closes out: if a hard contest
  //    arrived, it passes the shot up (resets) unless the clock forces it. This
  //    is how a good closeout *deters* a shot, not just lowers its odds.
  if (plan.shoot && state.offense === 'ai') {
    const shooter = byId(players, plan.shoot)
    const mustShoot = state.shotClock <= 1
    // A three needs a real window post-closeout; rim/mid looks are taken unless
    // truly smothered.
    const need = shooter && shotType(shooter.pos) === 'three' ? 0.45 : 0.22
    if (shooter && (mustShoot || openness(players, shooter) > need)) {
      return resolveShot({ ...state, players, rngState: r.next }, plan.shoot)
    }
    // Shot passed up; ball stays, clock ticks, the CPU re-plans next beat.
  }

  // 4. A pass called by the ball handler resolves this beat (one-shot).
  if (handler && handler.order.kind === 'pass') {
    const target = byId(players, handler.order.toId)
    const lead = handler.order.lead
    handler.order = { kind: 'idle' }
    if (target && target.side === handler.side) {
      // Lead pass to a cutter: they gather it in stride at the spot you aimed,
      // clamped to one gather stride from where their cut took them this beat
      // (movement already ran). If the ball is aimed well past where the receiver
      // can reach — too far ahead of the cut, or out into empty floor — it sails
      // away untouched: an errant pass the defense recovers.
      if (lead) {
        const aim = clampToCourt(lead)
        const catchPoint = clampToCourt(stepToward(target.pos, aim, reachOf(target, true)))
        if (dist(catchPoint, aim) > LEAD_CATCH_RADIUS) {
          const def = opponentOf(handler.side)
          events.push({ kind: 'turnover', from: handler.pos, to: aim, by: handler.id, text: 'Errant pass' })
          log = pushLog(log, `🟠 ${handler.name} sails it out of reach — ${sideName(def)} ball.`)
          return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_STEPS, log)
        }
        target.pos = catchPoint
      }
      // The steal check then judges the lane to that catch point.
      const { p: stealP, thief } = passStealChance(players, handler, target)
      if (thief && r.roll(stealP)) {
        events.push({ kind: 'steal', by: thief.id, from: handler.pos, to: { ...thief.pos }, text: `${thief.name} steals it!` })
        log = pushLog(log, `🧤 ${thief.name} jumps the lane — steal!`)
        return setupPossession({ ...state, players, rngState: r.next, events, log }, thief.side, SHOT_CLOCK_STEPS, log)
      }
      events.push({ kind: 'pass', from: handler.pos, to: target.pos, by: target.id, text: 'Pass' })
      // Catch and decide: the receiver gathers and goes idle so you (or the CPU)
      // pick the next action, rather than carrying on a stale cut with the ball.
      target.order = { kind: 'idle' }
      return finalizeClock({ ...state, players, ballHandlerId: target.id, rngState: r.next, events, log })
    }
  }

  // 5. On-ball gambles & strips, judged on post-movement positions.
  if (handler) {
    const gambler = players.find(
      (d) => d.side !== handler.side && d.order.kind === 'steal' && dist(d.pos, handler.pos) <= 8,
    )
    if (gambler) {
      const p = clampP(
        GAMBLE_STEAL_BASE + (statN(gambler.attr.perimeterD) - statN(handler.attr.handle)) * GAMBLE_STEAL_STAT_WEIGHT,
      )
      if (r.roll(p)) {
        events.push({ kind: 'steal', by: gambler.id, from: handler.pos, to: { ...gambler.pos }, text: `${gambler.name} strips it!` })
        log = pushLog(log, `🧤 ${gambler.name} gambles and gets it!`)
        return setupPossession({ ...state, players, rngState: r.next, events, log }, gambler.side, SHOT_CLOCK_STEPS, log)
      }
    }
    if (handler.order.kind === 'drive') {
      const onBall = players.find((d) => d.side !== handler.side && dist(d.pos, handler.pos) <= 6)
      if (onBall) {
        const p = clampP(
          STRIP_BASE +
            (statN(onBall.attr.perimeterD) - statN(handler.attr.handle)) * STRIP_STAT_WEIGHT +
            (handler.bull > 0 ? BULL_STRIP_BONUS : 0), // loose handle from bulling a body
        )
        if (r.roll(p)) {
          events.push({ kind: 'steal', by: onBall.id, from: handler.pos, to: { ...onBall.pos }, text: `${onBall.name} strips the drive!` })
          log = pushLog(log, `🧤 ${onBall.name} strips ${handler.name} on the drive!`)
          return setupPossession({ ...state, players, rngState: r.next, events, log }, onBall.side, SHOT_CLOCK_STEPS, log)
        }
      }
    }
  }

  // The handler kept the ball but the defense walled the drive — tell the player
  // why their drive came up short (rather than a silent, ignored-input feeling).
  if (handlerStalled && handler) {
    events.push({ kind: 'stall', by: handler.id, from: handler.pos, text: 'Bottled up!' })
    log = pushLog(log, `🚧 ${handler.name}'s drive is bottled up in traffic — kick it out or attack a gap.`)
  }

  return finalizeClock({ ...state, players, rngState: r.next, events, log })
}

/** Tick the shot clock (in STEPS) after a step's motion + contests have resolved.
 *  Motion already happened this step (see advanceMotion), so this only advances
 *  time. */
function finalizeClock(state: GameState): GameState {
  const shotClock = state.shotClock - 1
  const step = state.step + 1
  if (shotClock <= 0) {
    const def = opponentOf(state.offense)
    const log = pushLog(state.log, `⏱️ Shot-clock violation — ${sideName(def)} ball.`)
    const events: BeatEvent[] = [{ kind: 'shotclock', text: 'Shot-clock violation!' }]
    return setupPossession({ ...state, players: state.players, step, events, log }, def, SHOT_CLOCK_STEPS, log)
  }
  return { ...state, shotClock, step }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SET_ORDER': {
      if (state.phase !== 'play') return state
      const players = state.players.map((p) =>
        p.id === action.playerId ? { ...p, order: action.order } : p,
      )
      return { ...state, players, events: [] }
    }
    case 'RUN_STEP':
      return runStep(state)
    case 'CALL_SHOT': {
      if (state.phase !== 'play') return state
      // Let the defense close out one step before the shot resolves — the same
      // courtesy the CPU's shots get (which resolve post-movement in runStep).
      // Without this, a human could shoot before any defender recovered. The
      // shooter is planted so they don't drift; we move only (no timer decay) so
      // a fresh drive's finishing boost still counts.
      const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
      const shooter = byId(players, action.playerId)
      if (!shooter) return state
      shooter.order = { kind: 'idle' }
      applyMovement(players, state.ballHandlerId)
      return resolveShot({ ...state, players }, action.playerId)
    }
    case 'NEW_GAME':
      return createInitialState(action.seed)
    default:
      return state
  }
}
