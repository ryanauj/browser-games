import {
  BASKET,
  BLOCK_BASE_PERIMETER,
  BLOCK_BASE_RIM,
  BLOCK_STAT_WEIGHT,
  BULL_STAMINA,
  BULL_STRIP_BONUS,
  COLLIDE_DRIVE_MOMENTUM,
  COLLIDE_MASS_STRENGTH,
  COLLIDE_MAX_SHOVE,
  COLLIDE_MOMENTUM_WEIGHT,
  COLLIDE_RADIUS,
  CONTEST_RADIUS,
  DRIVE_FINISH_BONUS,
  GAMBLE_STEAL_BASE,
  GAMBLE_STEAL_STAT_WEIGHT,
  GASSED_THRESHOLD,
  LEAD_CATCH_RADIUS,
  OPENNESS_SHOT_WEIGHT,
  OREB_BASE,
  PASS_LANE_RADIUS,
  PASS_STEAL_BASE,
  PASS_STEAL_STAT_WEIGHT,
  SCREEN_BASE,
  SCREEN_BODY,
  SCREEN_HOLD_MAX,
  SCREEN_MAX,
  SCREEN_RADIUS,
  SEPARATION_MIN,
  SET_ANCHOR_BONUS,
  SET_MOTION_REF,
  SHOT_BASE,
  SHOT_CLOCK_BEATS,
  SHOT_CLOCK_RESET_OREB,
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
  stepToward,
  teammates,
} from './geometry'
import { aiPlan } from './ai'
import { ARCHETYPES, buildPlayers } from './roster'
import { nextRandom } from './rng'
import type { Action, BeatEvent, GameState, Player, Side, Vec } from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createInitialState(seed: number = Date.now()): GameState {
  const players = buildPlayers()
  const base: GameState = {
    phase: 'play',
    players,
    ballHandlerId: null,
    offense: 'player',
    shotClock: SHOT_CLOCK_BEATS,
    score: { player: 0, ai: 0 },
    possession: 0,
    beat: 0,
    winTarget: WIN_TARGET,
    seed: seed | 0,
    rngState: seed | 0,
    events: [],
    log: ['Tip-off — your ball.'],
  }
  return setupPossession(base, 'player', SHOT_CLOCK_BEATS, base.log)
}

/** Position both fives for a fresh possession: offense at home spots, defense
 *  man-up goal-side, ball to the offense's point guard. */
function setupPossession(
  state: GameState,
  offense: Side,
  clock: number,
  log: string[],
): GameState {
  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos }, stuck: 0, screenHeld: 0, primed: 0, bull: 0 }))
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

/** Movement orders that complete in a single beat (move there, then idle). */
const ONE_BEAT_MOVES = new Set(['move', 'cut', 'drive', 'help'])

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
 *  drive while a defender on the move gives way. Mutates the bulled defender's
 *  position (bounded by COLLIDE_MAX_SHOVE, recovered when he re-plans next beat).
 *  `defMove` maps each defender id to how far it intends to move this beat.
 *  Returns where the driver ends up and whether he bulled (loose handle). */
function driveCollision(
  driver: Player,
  from: Vec,
  want: Vec,
  defenders: Player[],
  defStart: Map<string, Vec>,
  defMove: Map<string, number>,
): { pos: Vec; bull: boolean } {
  const dx = want.x - from.x
  const dy = want.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { pos: want, bull: false }
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
  if (!hit) return { pos: want, bull: false }

  // The shove contest at the body.
  const driverPush = shoveMass(driver) + COLLIDE_DRIVE_MOMENTUM * len
  const setFactor = Math.max(0, Math.min(1, 1 - (defMove.get(hit.id) ?? 0) / SET_MOTION_REF))
  const defAnchor = shoveMass(hit) + SET_ANCHOR_BONUS * setFactor

  if (driverPush <= defAnchor) {
    // STOPPED: pull up just shy of the body — no phantom through.
    const stop = Math.max(0, hitT - 0.1)
    return { pos: { x: from.x + ux * stop, y: from.y + uy * stop }, bull: false }
  }

  // BULL THROUGH: the driver carries to his spot and knocks the man off his.
  // Shove the defender along the contact normal (the way the drive is going),
  // scaled by how decisively the drive won, capped so no one gets launched.
  const margin = Math.min(1, (driverPush - defAnchor) / Math.max(0.5, defAnchor))
  const shove = COLLIDE_MAX_SHOVE * (0.5 + 0.5 * margin)
  const dp = defStart.get(hit.id) ?? hit.pos
  hit.pos = clampToCourt({ x: dp.x + ux * shove, y: dp.y + uy * shove })
  return { pos: want, bull: true }
}

function applyMovement(players: Player[], ballHandlerId: string | null): { handlerStalled: boolean } {
  const ballHandler = byId(players, ballHandlerId)
  // Opponents setting a screen are solid bodies you must go around, not through.
  const screeners = players.filter((s) => s.order.kind === 'screen')
  // Where everyone started this beat — the shove resolver reads each body's
  // momentum (how far, and which way, it drove) from this.
  const before = new Map(players.map((p) => [p.id, { ...p.pos }]))
  // How far each player INTENDS to move this beat, from start-of-beat positions
  // (order-independent). The drive collision reads it to tell a SET defender
  // (anchored, barely moving) from one on the move.
  const intendedMove = new Map<string, number>()
  for (const p of players) {
    const burst = p.order.kind === 'drive' || p.order.kind === 'cut'
    let step = reachOf(p, burst)
    if (p.stuck > 0) step *= STUCK_FACTOR
    const target = targetFor(p, players, ballHandler)
    intendedMove.set(p.id, target ? dist(p.pos, stepToward(p.pos, target, step)) : 0)
  }
  let handlerStalled = false
  for (const p of players) {
    // Sprint floor: too gassed to drive/cut — degrade to a jog in place.
    if ((p.order.kind === 'drive' || p.order.kind === 'cut') && p.stamina < SPRINT_FLOOR) {
      p.order = { kind: 'idle' }
    }
    const burst = p.order.kind === 'drive' || p.order.kind === 'cut'
    let step = reachOf(p, burst) // drives/cuts explode past a jog's reach
    if (p.stuck > 0) step *= STUCK_FACTOR // hung up on a screen (decayed at beat start)
    // A drive primes a finishing boost on this handler's next shot.
    if (p.order.kind === 'drive') p.primed = 1
    const target = targetFor(p, players, ballHandler)
    if (target) {
      const want = stepToward(p.pos, target, step)
      // Can't run through a planted screener — go around (the physical pick).
      const blockers = screeners.filter((s) => s.side !== p.side && s.id !== p.id)
      let next = clampToCourt(blockedStep(p.pos, want, blockers, SCREEN_BODY))
      // Defenders in your lane SLOW you — no teleporting through (the old bug) and
      // no hard wall (you can still fight downhill past a man). This models the
      // DEFENSE taking your ground, so it applies to whoever is attacking it: every
      // offensive mover (the drive AND off-ball cutters), never the defenders —
      // slowing a defender who lives in contact with his man would gut the closeout.
      if (p.id === ballHandlerId && p.order.kind === 'drive') {
        // The DRIVER is a solid body meeting solid bodies: bull through (shove the
        // man off his spot) or get stopped dead — never slip through. Defenders
        // are read from their start-of-beat spots so the resolution is order-
        // independent and replays stay exact.
        const bodies = players.filter((o) => o.side !== p.side && o.id !== p.id && o.order.kind !== 'screen')
        const { pos, bull } = driveCollision(p, p.pos, next, bodies, before, intendedMove)
        const settled = clampToCourt(pos)
        // Stall cue: contact STUFFED the drive (kept under STALL_KEPT_FRACTION of
        // its ground) — but a clean bull-through that covered its lane stays quiet.
        const intended = dist(p.pos, next)
        const kept = dist(p.pos, settled)
        if (!bull && intended >= STALL_MIN_DRIVE && kept < intended * STALL_KEPT_FRACTION) handlerStalled = true
        if (bull) p.bull = 1 // loose handle (strip risk) + extra legs, charged below
        next = settled
      } else if (ballHandler && p.side === ballHandler.side) {
        // Off-ball offensive movers (cutters, relocations) are merely SLOWED by
        // bodies in their lane — they don't bull, and they don't tunnel through.
        next = clampToCourt(contestedStep(p.pos, next, players.filter((o) => o.side !== p.side && o.id !== p.id && o.order.kind !== 'screen'), p.attr.strength))
      }
      p.pos = next
      // A direct move is one beat: once arrived, drop to idle so the coach
      // re-orders (and the player recovers) rather than drifting on.
      if (ONE_BEAT_MOVES.has(p.order.kind) && dist(p.pos, target) < 1.2) p.order = { kind: 'idle' }
    }
    const cost = STAMINA_COST[p.order.kind] + (p.bull > 0 ? BULL_STAMINA : 0)
    p.stamina = Math.max(0, Math.min(100, p.stamina - cost))
  }
  // No two bodies end a beat stacked — resolved as a strength/momentum shove.
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
    return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_BEATS, log)
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
    return setupPossession({ ...state, players, rngState: r.next, score, events, log }, def, SHOT_CLOCK_BEATS, log)
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
  return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_BEATS, log)
}

/** Advance one beat of motion: decay screen/drive timers, resolve planted
 *  screens, then move every player along their standing order. Mutates players.
 *  Returns whether the ball handler's drive was throttled by traffic this beat. */
function advanceMotion(players: Player[], ballHandlerId: string | null): { handlerStalled: boolean } {
  for (const p of players) {
    if (p.stuck > 0) p.stuck -= 1
    if (p.primed > 0) p.primed -= 1 // a finishing boost expires if no shot followed
    p.bull = 0 // loose handle is recomputed each beat by the collision
  }
  resolveScreens(players)
  return applyMovement(players, ballHandlerId)
}

function runBeat(state: GameState): GameState {
  if (state.phase === 'gameover') return state

  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  const r = new Roll(state.rngState)
  let events: BeatEvent[] = []
  let log = state.log

  // 1. The CPU floor general sets its five's orders (and may commit to a shot).
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
  const { handlerStalled } = advanceMotion(players, state.ballHandlerId)

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
          return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_BEATS, log)
        }
        target.pos = catchPoint
      }
      // The steal check then judges the lane to that catch point.
      const { p: stealP, thief } = passStealChance(players, handler, target)
      if (thief && r.roll(stealP)) {
        events.push({ kind: 'steal', by: thief.id, from: handler.pos, to: { ...thief.pos }, text: `${thief.name} steals it!` })
        log = pushLog(log, `🧤 ${thief.name} jumps the lane — steal!`)
        return setupPossession({ ...state, players, rngState: r.next, events, log }, thief.side, SHOT_CLOCK_BEATS, log)
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
        return setupPossession({ ...state, players, rngState: r.next, events, log }, gambler.side, SHOT_CLOCK_BEATS, log)
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
          return setupPossession({ ...state, players, rngState: r.next, events, log }, onBall.side, SHOT_CLOCK_BEATS, log)
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

/** Tick the shot clock after a beat's motion + contests have resolved. Motion
 *  already happened this beat (see advanceMotion), so this only advances time. */
function finalizeClock(state: GameState): GameState {
  const shotClock = state.shotClock - 1
  const beat = state.beat + 1
  if (shotClock <= 0) {
    const def = opponentOf(state.offense)
    const log = pushLog(state.log, `⏱️ Shot-clock violation — ${sideName(def)} ball.`)
    const events: BeatEvent[] = [{ kind: 'shotclock', text: 'Shot-clock violation!' }]
    return setupPossession({ ...state, players: state.players, beat, events, log }, def, SHOT_CLOCK_BEATS, log)
  }
  return { ...state, shotClock, beat }
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
    case 'RUN_BEAT':
      return runBeat(state)
    case 'CALL_SHOT': {
      if (state.phase !== 'play') return state
      // Let the defense close out one beat before the shot resolves — the same
      // courtesy the CPU's shots get (which resolve post-movement in runBeat).
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
