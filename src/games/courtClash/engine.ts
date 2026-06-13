import {
  BASE_STEP,
  BASKET,
  BLOCK_BASE_PERIMETER,
  BLOCK_BASE_RIM,
  BLOCK_STAT_WEIGHT,
  CONTEST_RADIUS,
  GAMBLE_STEAL_BASE,
  GAMBLE_STEAL_STAT_WEIGHT,
  GASSED_FACTOR,
  GASSED_THRESHOLD,
  OPENNESS_SHOT_WEIGHT,
  OREB_BASE,
  PASS_LANE_RADIUS,
  PASS_STEAL_BASE,
  PASS_STEAL_STAT_WEIGHT,
  SCREEN_BASE,
  SCREEN_HOLD_MAX,
  SCREEN_MAX,
  SCREEN_RADIUS,
  SHOT_BASE,
  SHOT_CLOCK_BEATS,
  SHOT_CLOCK_RESET_OREB,
  SHOT_STAT_WEIGHT,
  SPEED_STEP_BONUS,
  SPRINT_FLOOR,
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
  dist,
  distToRim,
  distToSegment,
  openness,
  opponentOf,
  rangePenalty,
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
  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos }, stuck: 0, screenHeld: 0 }))
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

function stepLen(p: Player): number {
  const base = BASE_STEP + (p.attr.speed / 99) * SPEED_STEP_BONUS
  return isGassed(p) ? base * GASSED_FACTOR : base
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
    case 'screen':
      return p.order.to
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
    // Don't set the pick until the screener has actually planted at the spot —
    // otherwise it would instantly "screen" whoever happens to be adjacent
    // (often its own defender) and free itself before ever travelling.
    const planted = dist(s.pos, s.order.to) <= SCREEN_RADIUS
    if (!planted) continue
    s.screenHeld += 1
    let connected = false
    for (const d of players) {
      if (d.side === s.side) continue
      if (dist(d.pos, s.pos) > SCREEN_RADIUS) continue
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

function applyMovement(players: Player[], ballHandlerId: string | null): void {
  const ballHandler = byId(players, ballHandlerId)
  for (const p of players) {
    // Sprint floor: too gassed to drive/cut — degrade to a jog in place.
    if ((p.order.kind === 'drive' || p.order.kind === 'cut') && p.stamina < SPRINT_FLOOR) {
      p.order = { kind: 'idle' }
    }
    let step = stepLen(p)
    if (p.stuck > 0) step *= STUCK_FACTOR // hung up on a screen (decayed at beat start)
    const target = targetFor(p, players, ballHandler)
    if (target) p.pos = clampToCourt(stepToward(p.pos, target, step))
    const cost = STAMINA_COST[p.order.kind]
    p.stamina = Math.max(0, Math.min(100, p.stamina - cost))
  }
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
        proximity * 0.18 +
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
    (isGassed(shooter) ? 0.08 : 0)
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
    events.push({ kind: 'rebound', by: crasher.id, text: `${crasher.name} — offensive board!` })
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
  events.push({ kind: 'rebound', by: grabber.id, text: `${grabber.name} rebounds.` })
  log = pushLog(log, `🔁 ${grabber.name} grabs the board — ${sideName(def)} ball.`)
  return setupPossession({ ...state, players, rngState: r.next, events, log }, def, SHOT_CLOCK_BEATS, log)
}

function runBeat(state: GameState): GameState {
  if (state.phase === 'gameover') return state

  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  const r = new Roll(state.rngState)
  let events: BeatEvent[] = []
  let log = state.log

  // 1. CPU floor general orders its five (and may pull the trigger on offense).
  const plan = aiPlan({ ...state, players })
  for (const o of plan.orders) {
    const p = byId(players, o.playerId)
    if (p) p.order = o.order
  }
  if (plan.shoot && state.offense === 'ai') {
    return resolveShot({ ...state, players, rngState: r.next }, plan.shoot)
  }

  // 2. A pass called by the ball handler resolves this beat (one-shot).
  const handler = byId(players, state.ballHandlerId)
  if (handler && handler.order.kind === 'pass') {
    const target = byId(players, handler.order.toId)
    handler.order = { kind: 'idle' }
    if (target && target.side === handler.side) {
      const { p: stealP, thief } = passStealChance(players, handler, target)
      if (thief && r.roll(stealP)) {
        events.push({ kind: 'steal', by: thief.id, from: handler.pos, to: target.pos, text: `${thief.name} steals it!` })
        log = pushLog(log, `🧤 ${thief.name} jumps the lane — steal!`)
        return setupPossession({ ...state, players, rngState: r.next, events, log }, thief.side, SHOT_CLOCK_BEATS, log)
      }
      events.push({ kind: 'pass', from: handler.pos, to: target.pos, by: target.id, text: 'Pass' })
      return decClockAndMove({ ...state, players, ballHandlerId: target.id, rngState: r.next, events, log })
    }
  }

  // 3. On-ball gambles & strips.
  if (handler) {
    const gambler = players.find(
      (d) => d.side !== handler.side && d.order.kind === 'steal' && dist(d.pos, handler.pos) <= 8,
    )
    if (gambler) {
      const p = clampP(
        GAMBLE_STEAL_BASE + (statN(gambler.attr.perimeterD) - statN(handler.attr.handle)) * GAMBLE_STEAL_STAT_WEIGHT,
      )
      if (r.roll(p)) {
        events.push({ kind: 'steal', by: gambler.id, from: handler.pos, text: `${gambler.name} strips it!` })
        log = pushLog(log, `🧤 ${gambler.name} gambles and gets it!`)
        return setupPossession({ ...state, players, rngState: r.next, events, log }, gambler.side, SHOT_CLOCK_BEATS, log)
      }
    }
    if (handler.order.kind === 'drive') {
      const onBall = players.find((d) => d.side !== handler.side && dist(d.pos, handler.pos) <= 6)
      if (onBall) {
        const p = clampP(STRIP_BASE + (statN(onBall.attr.perimeterD) - statN(handler.attr.handle)) * STRIP_STAT_WEIGHT)
        if (r.roll(p)) {
          events.push({ kind: 'steal', by: onBall.id, from: handler.pos, text: `${onBall.name} strips the drive!` })
          log = pushLog(log, `🧤 ${onBall.name} strips ${handler.name} on the drive!`)
          return setupPossession({ ...state, players, rngState: r.next, events, log }, onBall.side, SHOT_CLOCK_BEATS, log)
        }
      }
    }
  }

  return decClockAndMove({ ...state, players, rngState: r.next, events, log })
}

function decClockAndMove(state: GameState): GameState {
  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  // Decay any lingering screen-stick from a prior beat, then set fresh picks so
  // a connection persists into the rendered state (slow + indicator) this beat.
  for (const p of players) if (p.stuck > 0) p.stuck -= 1
  resolveScreens(players)
  applyMovement(players, state.ballHandlerId)
  const shotClock = state.shotClock - 1
  const beat = state.beat + 1
  if (shotClock <= 0) {
    const def = opponentOf(state.offense)
    const log = pushLog(state.log, `⏱️ Shot-clock violation — ${sideName(def)} ball.`)
    const events: BeatEvent[] = [{ kind: 'shotclock', text: 'Shot-clock violation!' }]
    return setupPossession({ ...state, players, beat, events, log }, def, SHOT_CLOCK_BEATS, log)
  }
  return { ...state, players, shotClock, beat }
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
    case 'CALL_SHOT':
      if (state.phase !== 'play') return state
      return resolveShot(state, action.playerId)
    case 'NEW_GAME':
      return createInitialState(action.seed)
    default:
      return state
  }
}
