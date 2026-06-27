import {
  BASKET,
  BLOCK_BASE_PERIMETER,
  BLOCK_BASE_RIM,
  BLOCK_STAT_WEIGHT,
  CONTEST_RADIUS,
  CUTOFF_LEAD,
  CUTOFF_RIM_DOT,
  CUTOFF_SPRINT_MIN,
  GAMBLE_RANGE,
  GAMBLE_THREAT_RIM,
  HELP_PAINT_RADIUS,
  MAX_SHOT_RANGE,
  OPENNESS_SHOT_WEIGHT,
  PASS_INTERCEPT_RADIUS,
  RIM_RADIUS,
  SHOT_BASE,
  SHOT_STAT_WEIGHT,
  THREE_PT_RADIUS,
} from './constants'
import { clampToCourt, dist, distToRim, distToSegment, nearestOpponent, openness, opponentOf, shotType, stepToward, unitTo } from './geometry'
import { reducer } from './engine'
import type { Action, GameState, Order, Player, Side, Vec } from './types'

const statN = (v: number): number => (v - 50) / 49

/** Positional estimate of the block risk on a shot from here — a cheap mirror of
 *  engine.blockChance (nearest contester within CONTEST_RADIUS, steeper at the
 *  rim, scaled by proximity and the contester's interior D). Replicated rather
 *  than imported to keep ai←engine one-way. Without this the CPU OVERVALUES a rim
 *  finish — it reads the open-floor make and ignores the rim protector waiting at
 *  release, so it drives into a wall it can't see (the EV↔engine misalignment the
 *  panel flagged). Folding it in lets a contested rim attack score below a clean
 *  kickout, which is what tips the rollout off the auto-drive. */
function blockEstimate(p: Player, players: Player[]): number {
  let bestDist = Infinity
  let blocker: Player | null = null
  for (const d of players) {
    if (d.side === p.side) continue
    const dd = dist(d.pos, p.pos)
    if (dd < bestDist && dd <= CONTEST_RADIUS) {
      bestDist = dd
      blocker = d
    }
  }
  if (!blocker) return 0
  const rimCloseness = 1 - Math.min(1, distToRim(p.pos) / THREE_PT_RADIUS)
  const base = BLOCK_BASE_PERIMETER + (BLOCK_BASE_RIM - BLOCK_BASE_PERIMETER) * rimCloseness
  const proximity = 1 - bestDist / CONTEST_RADIUS
  return Math.max(0, Math.min(0.97, base * (0.4 + 0.6 * proximity) + statN(blocker.attr.interiorD) * BLOCK_STAT_WEIGHT))
}

/** A quick estimate of a player's shot value from here (points × make chance),
 *  mirroring shotMakeChance's main terms. Used by the CPU to pick the best look
 *  without importing the engine (keeps the dependency one-way). */
function shotEV(p: Player, players: Player[]): { ev: number; open: number } {
  const type = shotType(p.pos)
  const open = openness(players, p)
  const skill = type === 'layup' ? p.attr.finishing : p.attr.shooting
  const make = Math.max(
    0.03,
    Math.min(0.97, SHOT_BASE[type] + OPENNESS_SHOT_WEIGHT * (open - 0.4) + statN(skill) * SHOT_STAT_WEIGHT),
  )
  // Block survives separately at release (engine rolls it BEFORE the make), so the
  // realized scoring chance is make × (1 − blockP). The rim is where this bites.
  const scoreChance = make * (1 - blockEstimate(p, players))
  let ev = scoreChance * (type === 'three' ? 3 : 2)
  // Long-two tax: the settled mid-range jumper is the worst shot in basketball.
  // Discount it so the CPU prefers getting to the rim or kicking out for three.
  if (type === 'two' && distToRim(p.pos) > RIM_RADIUS + 6) ev *= 0.85
  return { ev, open }
}

export interface AiPlan {
  /** Each entry sets a player's active `order` and, optionally, its pending
   *  plan-ahead chain `queue` (Q42). Omitted `queue` clears it (the AI re-plans
   *  every step, so it re-emits the chain each time). */
  orders: { playerId: string; order: Order; queue?: Order[] }[]
  /** If set (and the AI is on offense), the CPU pulls the trigger this beat. */
  shoot?: string
}

/** STUB plan-ahead chain (P1 — Q42/Q46). The real multi-step COMMITTED planner is
 *  P2; for now the AI expresses its single chosen intent as a shallow 1–3-deep
 *  queue so the auto-run loop has a committed chain to fast-forward (a player with
 *  a non-empty queue isn't "out of plan", Q43). A committed line (drive / cut /
 *  sprint-move) repeats itself — re-committing the same target keeps the accel ramp
 *  alive (Q12); reactive orders hold (empty chain). Replaced wholesale by P2. */
const STUB_QUEUE_DEPTH = 2
function stubChain(order: Order): Order[] {
  switch (order.kind) {
    case 'drive':
    case 'cut':
      return Array<Order>(STUB_QUEUE_DEPTH).fill(order)
    case 'move':
      return order.mode === 'sprint' ? Array<Order>(STUB_QUEUE_DEPTH).fill(order) : []
    default:
      return []
  }
}

/** Canonical drive-and-kick spacing (team attacking the rim at small Y). Four
 *  perimeter stations sit on/behind the arc as catch-and-shoot release valves;
 *  the dunker spot keeps a body near the rim for dump-offs and the offensive
 *  glass. A spread floor is what makes a kickout a real shot — and what forces
 *  the defense into the help-and-recover choices the offense punishes. */
const SPACE_SPOTS: Vec[] = [
  { x: 8, y: 15 }, // left corner three
  { x: 92, y: 15 }, // right corner three
  { x: 22, y: 48 }, // left wing three
  { x: 78, y: 48 }, // right wing three
  { x: 50, y: 62 }, // top of the key
]
const DUNKER_SPOT: Vec = { x: 64, y: 17 }

/** Spread the four off-ball players four-out, one-in: the weakest shooter ducks
 *  to the dunker spot (a dump-off + offensive-board threat that keeps the rim
 *  protector honest near the paint), the other three fan out to the nearest open
 *  perimeter stations as catch-and-shoot valves. This keeps a balanced 4-on-4 on
 *  the arc — so the defense can contest both the rim AND the perimeter, which is
 *  what lets active defense matter. Deterministic (stable order, nearest-spot
 *  greedy) so the reducer stays pure and replays exact. A player already on its
 *  spot idles to catch its breath rather than jittering in place. */
function spacingOrders(handler: Player, players: Player[], ai: Player[]): { playerId: string; order: Order }[] {
  const offBall = ai.filter((p) => p.id !== handler.id)
  const big = offBall.reduce((a, b) => (a.attr.shooting <= b.attr.shooting ? a : b))
  const perim = offBall.filter((p) => p.id !== big.id)
  const orders: { playerId: string; order: Order }[] = []
  const used = new Set<number>()
  for (const p of perim) {
    const def = nearestOpponent(players, p)
    const covered = def ? dist(def.pos, p.pos) < 8 : false
    // Pick a station. When a defender is draped on, relocate to the spot that puts
    // the most daylight between the shooter and his man (a re-space to open ground)
    // — this is how off-ball shooters get open for the catch-and-shoot, and it
    // makes the defense chase, so a non-rotating defense surrenders the clean look.
    // When already open, just take the nearest station and set your feet.
    let bi = -1
    let best = -Infinity
    for (let i = 0; i < SPACE_SPOTS.length; i++) {
      if (used.has(i)) continue
      const spot = SPACE_SPOTS[i]
      const sep = def ? dist(def.pos, spot) : 0
      const score = covered ? sep - 0.35 * dist(p.pos, spot) : -dist(p.pos, spot)
      if (score > best) {
        best = score
        bi = i
      }
    }
    used.add(bi)
    const spot = clampToCourt(SPACE_SPOTS[bi])
    const arrived = dist(p.pos, spot) < 2.5
    // Off-ball relocations are reactive jogs (no committed momentum) — re-aiming
    // each step is free, which is the point of spacing to open ground (Q13).
    orders.push({ playerId: p.id, order: arrived ? { kind: 'idle' } : { kind: 'move', to: spot, mode: 'jog' } })
  }
  const dunk = clampToCourt(DUNKER_SPOT)
  orders.push({ playerId: big.id, order: dist(big.pos, dunk) < 2.5 ? { kind: 'idle' } : { kind: 'move', to: dunk, mode: 'jog' } })
  return orders
}

// ===========================================================================
// COMMITTED-INTENT + PREDICTIVE-ROLLOUT FLOOR GENERAL (Q25)
//
// The real planner. The placeholder it replaces re-decided every step (greedy,
// per-step) so it could never hold a committed line — and the model only grants
// sprint speed by committing (re-targeting resets the accel ramp, Q12/Q24). This
// planner instead:
//
//   1. COMMITS INTENTS. An offensive intent (drive a line, attack a gap, kick to
//      a named valve, set/use a ball screen, pull up) is expressed as a standing
//      `Order` that PERSISTS across steps. Re-emitting the same target each step
//      is "continue" — momentum keeps building (no redirect tax); switching to a
//      different-heading order is a "bail" that the engine charges the Q5
//      angle×speed cost for. A small hysteresis bonus on continuing the current
//      committed sprint keeps the AI from thrashing its own momentum.
//   2. SELECTS BY PREDICTIVE ROLLOUT. Each candidate intent is scored by cloning
//      the state and running the REAL pure reducer forward N steps (real shots,
//      passes, lane interception), then reading the resulting EV — the best look
//      the ball reaches — net a turnover penalty if the possession is coughed up.
//      The opponent is PREDICTED as continuing its revealed (last-step) orders;
//      we never read the human's order committed THIS step (Q16-legal — this is a
//      predictive rollout, not a best-response to a hidden order).
//
// DETERMINISM (the trap): the rollout must not corrupt replay. It runs on a deep
// clone whose `rngState` is a SEPARATE derived seed (a hash of the live state), so
// (a) the live `rngState` only ever advances on a real RUN_STEP, never during a
// hypothetical, and (b) the AI can't peek the actual RNG outcome of its own shot.
// A module-local re-entrancy guard makes the reducer's *internal* aiPlan call use
// a cheap persist-orders policy inside a rollout — preventing infinite recursion
// and giving the "opponent continues its orders" prediction for free. aiPlan stays
// a PURE function of the state it's handed (no Date/Math.random, no live mutation),
// which is what keeps `pnpm determinism` byte-identical across all 10 seeds.
// ===========================================================================

/** Rollout horizon (steps). Short — a few steps is enough to read whether an
 *  intent reaches a real look; the planner re-selects every step. */
const ROLLOUT_STEPS = 5
/** A coughed-up possession (steal / errant pass / shot-clock) is worth roughly a
 *  forfeited point of expectation — subtract it from a candidate's best look so a
 *  turnover-prone line doesn't out-score a safe one with the same upside. */
const TURNOVER_PENALTY = 0.8
/** Hysteresis: a touch added to the candidate that CONTINUES the current
 *  committed sprint, so the AI keeps its momentum unless a switch clearly wins
 *  (re-targeting would reset the accel ramp, Q12). */
const COMMIT_HYSTERESIS = 0.1

/** Clear-lane / breakaway: if NO defender is within this distance of the handler's
 *  straight path to the rim, the lane is open and the right play is to attack the
 *  rim and FINISH — not swing the ball back out for a jumper. In half-court man
 *  defense the on-ball man (and any help) sit on/near that lane, so this never
 *  trips; it fires only on a genuinely open floor (a fast break, or the no-defense
 *  counterfactual). See the breakaway gate in planOffense. */
const BREAKAWAY_LANE_GUARD = 12

const byId = (players: Player[], id: string | null | undefined): Player | undefined =>
  id == null ? undefined : players.find((p) => p.id === id)

/** Re-entrancy depth. >0 means we're INSIDE a rollout — the reducer's internal
 *  aiPlan call must not start its own rollout (recursion + cost) and instead just
 *  persists the committed orders (the "opponent continues" prediction). Always
 *  returns to 0 between top-level calls (try/finally), so aiPlan remains a pure
 *  function of its input state — never coupled to call count (the replay gate). */
let rolloutDepth = 0

/** Derive a SEPARATE rollout RNG from the live state — deterministic (pure
 *  function of `rngState`) but distinct from it, so a hypothetical neither
 *  advances the real RNG nor peeks the real shot's outcome. xorshift32. */
function deriveSeed(s: number): number {
  let x = (s ^ 0x9e3779b9) | 0
  x ^= x << 13
  x |= 0
  x ^= x >>> 17
  x ^= x << 5
  return x | 0
}

/** A clone deep enough that running the reducer on it can't touch the live state.
 *  (The reducer is already pure — it maps players to fresh objects each step — so
 *  we only need to detach what WE mutate: player orders, rngState, score.) */
function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, pos: { ...p.pos }, queue: p.queue.slice() })),
    ball: s.ball
      ? { ...s.ball, pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, from: { ...s.ball.from }, to: { ...s.ball.to } }
      : null,
    gather: s.gather ? { ...s.gather } : null,
    score: { ...s.score },
    events: [],
  }
}

/** The EV of the look currently in `side`'s hands: the ball handler's own shot
 *  value from where he stands (positional, no RNG). 0 while the ball is in flight
 *  or the other side holds it. This is what a rollout "reads" at the horizon —
 *  and because shotEV ranks an open rim finish (~1.4) above an open three (~1.2),
 *  the planner VALUES rim attacks correctly even though the current gather over-
 *  blocks them at release (the advisory artifact is a tuning concern, not ours). */
function ballEV(s: GameState, side: Side): number {
  const h = byId(s.players, s.ballHandlerId)
  if (!h || h.side !== side) return 0
  return shotEV(h, s.players).ev
}

/** Predictive rollout score for one candidate set of orders, for `side` on
 *  offense. Clone → set the candidate's orders → roll the REAL reducer forward
 *  with a derived RNG, the opponent continuing its revealed orders. Value =
 *  the best look the ball reached over the window, minus a turnover penalty if
 *  the possession was lost without a shot going up. Pure + deterministic. */
function rolloutScore(state: GameState, side: Side, orders: { playerId: string; order: Order }[], shoot?: string): number {
  let cur = cloneState(state)
  cur.rngState = deriveSeed(state.rngState)
  for (const o of orders) {
    const p = byId(cur.players, o.playerId)
    if (p) p.order = o.order
  }
  const startPoss = cur.possession
  let peak = ballEV(cur, side)
  let shotResolved = false
  let turnover = false

  rolloutDepth += 1
  try {
    // First step honors an explicit shoot intent (start the gather); the rest just
    // advance the committed routes (the internal aiPlan persists them, depth>0).
    const first: Action = shoot ? { type: 'CALL_SHOT', playerId: shoot } : { type: 'RUN_STEP' }
    cur = reducer(cur, first)
    for (let i = 0; ; i++) {
      for (const e of cur.events) {
        if (e.kind === 'shotMake' || e.kind === 'shotMiss' || e.kind === 'block') shotResolved = true
        else if (e.kind === 'steal' || e.kind === 'turnover' || e.kind === 'shotclock') turnover = true
      }
      const ev = ballEV(cur, side)
      if (ev > peak) peak = ev
      // A possession change (made shot, turnover, defensive board, shot clock)
      // ends this line — stop reading past it.
      if (cur.possession !== startPoss || cur.phase === 'gameover') break
      if (i >= ROLLOUT_STEPS - 1) break
      cur = reducer(cur, { type: 'RUN_STEP' })
    }
  } finally {
    rolloutDepth -= 1
  }

  // A resolved shot is valued at the (EV-correct) look we generated; a turnover
  // forfeits the possession; otherwise it's the best look reached in the window.
  if (turnover && !shotResolved) return peak - TURNOVER_PENALTY
  return peak
}

/** The cheap policy used INSIDE a rollout (rolloutDepth>0): persist every order
 *  for `side` (so committed sprints keep building momentum and spacing holds),
 *  and — if `side` is on offense — let a SET handler with a genuinely good look
 *  pull the trigger so a possession can actually resolve into points within the
 *  window. No nested rollout (that's the recursion the guard exists to stop). */
function persistPlan(s: GameState, side: Side): AiPlan {
  const mine = s.players.filter((p) => p.side === side)
  // STUB: the rollout does NOT carry plan-ahead chains (queue omitted → cleared in
  // the hypothetical). The real multi-step committed planner that rolls out chains
  // is P2; keeping the rollout chain-free here means the P1 stub queue is inert in
  // the AI's actual decisions — existing self-play behavior is unchanged.
  const orders = mine.map((p) => ({ playerId: p.id, order: p.order }))
  let shoot: string | undefined
  if (s.offense === side && !s.ball && !s.gather) {
    const h = byId(s.players, s.ballHandlerId)
    // Only a rooted/set handler shoots in-sim — a driver keeps attacking, so the
    // rollout reads the drive's EV at the rim rather than firing the over-blocked
    // gather. Mirrors the engine's own take-gate so the shot isn't vetoed.
    if (h && h.side === side && h.order.kind === 'idle') {
      const { ev, open } = shotEV(h, s.players)
      const need = shotType(h.pos) === 'three' ? 0.45 : 0.22
      if (distToRim(h.pos) < MAX_SHOT_RANGE * 0.95 && (s.shotClock <= 2 || (ev >= 0.9 && open >= need))) shoot = h.id
    }
  }
  return { orders, shoot }
}

// ---- Offense: committed intents, chosen by predictive rollout ---------------

/** Teammates worth a kick: in shooting range, with a passing lane the defense
 *  can't read (no defender body sitting in it — a clean catch-and-shoot outlet),
 *  ranked by their shot value. The handler is the swing point of the offense, so
 *  these are the named valves an intent can kick to. */
function kickTargets(handler: Player, players: Player[], ai: Player[]): Player[] {
  const opp = players.filter((p) => p.side !== handler.side)
  const cands: { m: Player; ev: number }[] = []
  for (const m of ai) {
    if (m.id === handler.id) continue
    if (distToRim(m.pos) >= MAX_SHOT_RANGE) continue
    // Don't throw it through a defender's chest — a body in the lane is a live
    // interception (Q32 is purely positional now), so skip a clogged outlet.
    let laneClear = true
    for (const d of opp) {
      if (distToSegment(d.pos, handler.pos, m.pos) < PASS_INTERCEPT_RADIUS + 1) {
        laneClear = false
        break
      }
    }
    if (!laneClear) continue
    cands.push({ m, ev: shotEV(m, players).ev })
  }
  cands.sort((a, b) => b.ev - a.ev || a.m.id.localeCompare(b.m.id))
  return cands.slice(0, 2).map((c) => c.m)
}

/** A drive line that attacks the gap AWAY from the on-ball defender — a counter
 *  to a man shading one shoulder, giving the rollout a second downhill option
 *  besides the straight rim attack. */
function gapDrive(handler: Player, players: Player[]): Vec {
  const onBall = nearestOpponent(players, handler)
  const side = onBall && onBall.pos.x > handler.pos.x ? -1 : 1
  return clampToCourt({ x: BASKET.x + side * 10, y: BASKET.y + 4 })
}

function planOffense(state: GameState, side: Side): AiPlan {
  const players = state.players
  const ai = players.filter((p) => p.side === side)
  const handler = byId(players, state.ballHandlerId)

  // A windup is in progress (the shooter is rooted): just keep the floor spaced
  // and let the engine carry the gather to release — don't try to re-decide it.
  if (state.gather) {
    const shooter = byId(players, state.gather.shooterId)
    const sh = shooter && shooter.side === side ? shooter : handler
    const orders = sh ? spacingOrders(sh, players, ai) : ai.map((p) => ({ playerId: p.id, order: p.order }))
    return { orders }
  }
  // The ball is in flight (a kick we threw) or we simply don't hold it: hold the
  // committed orders so the receiver runs onto the catch and the others stay home.
  if (!handler || handler.side !== side) {
    return { orders: ai.map((p) => ({ playerId: p.id, order: p.order })) }
  }

  // Buzzer-beater: out of time to develop anything — put it up.
  if (state.shotClock <= 1) {
    return { orders: [...spacingOrders(handler, players, ai), { playerId: handler.id, order: { kind: 'idle' } }], shoot: handler.id }
  }

  const offBall = spacingOrders(handler, players, ai)
  /** Assemble a full team plan: the off-ball spacing, the handler's chosen order,
   *  and an optional override of one off-ball man (a screener). */
  const assemble = (handlerOrder: Order, override?: { playerId: string; order: Order }): { playerId: string; order: Order }[] => {
    const base = override ? offBall.filter((o) => o.playerId !== override.playerId) : offBall
    const all = [...base, { playerId: handler.id, order: handlerOrder }]
    if (override) all.push(override)
    return all
  }

  const here = shotEV(handler, players)
  const inRange = distToRim(handler.pos) < MAX_SHOT_RANGE * 0.95
  const needOpen = shotType(handler.pos) === 'three' ? 0.45 : 0.22

  // BREAKAWAY: is the path to the rim genuinely uncontested? On an open floor a
  // layup (~68%) and an open three (~45%) are an EV tie, so the rollout would kick
  // it back out for the three even with NOBODY home — the depressed open-floor
  // offense (FG-open < FG-guarded) the purist flagged. When the lane is clear the
  // correct play is unambiguous: attack the rim and finish. Detected positionally
  // (no defender on the line to the basket) so it fires ONLY on a true open floor /
  // fast break and leaves the half-court drive-and-kick EV read fully intact.
  const laneClear = !players.some(
    (d) => d.side !== side && distToSegment(d.pos, handler.pos, BASKET) < BREAKAWAY_LANE_GUARD,
  )

  interface Cand {
    orders: { playerId: string; order: Order }[]
    shoot?: string
    bonus: number
    label: string
  }
  const cands: Cand[] = []

  // CONTINUE the current committed sprint (momentum-preserving) — only if the
  // handler is actually on a committed move/drive line worth continuing.
  if (handler.order.kind === 'drive' || (handler.order.kind === 'move' && handler.order.mode === 'sprint')) {
    cands.push({ orders: assemble(handler.order), bonus: COMMIT_HYSTERESIS, label: 'continue' })
  }
  // DRIVE a line: straight at the rim, and a gap counter.
  cands.push({ orders: assemble({ kind: 'drive', to: { ...BASKET } }), bonus: 0, label: 'drive-rim' })
  cands.push({ orders: assemble({ kind: 'drive', to: gapDrive(handler, players) }), bonus: 0, label: 'drive-gap' })
  // PULL UP / shoot from here — only when the look would actually clear the
  // engine's take-gate, so choosing it always fires (no wasted rooted step). On a
  // breakaway, only pull up once at the rim (a layup) — settling for a jumper with
  // an open lane is exactly the mis-selection we're fixing.
  if (inRange && here.open >= needOpen && (!laneClear || shotType(handler.pos) === 'layup')) {
    cands.push({ orders: assemble({ kind: 'idle' }), shoot: handler.id, bonus: 0, label: 'pullup' })
  }
  // KICK to a named valve (drive-and-kick): the open shooter help left behind.
  // Suppressed on a breakaway — with the lane open, swinging it back out is a worse
  // look than the finish, so the handler keeps attacking the rim.
  if (!laneClear)
    for (const m of kickTargets(handler, players, ai)) {
      cands.push({ orders: assemble({ kind: 'pass', toId: m.id }), bonus: 0, label: `kick-${m.id}` })
    }
  // SET/USE a ball screen when the handler is hemmed in — the nearest teammate
  // picks the on-ball man while the handler attacks off it.
  if (!laneClear && here.open < 0.5) {
    const onBall = nearestOpponent(players, handler)
    let screener: Player | null = null
    let bestD = Infinity
    for (const m of ai) {
      if (m.id === handler.id) continue
      const d = dist(m.pos, handler.pos)
      if (d < bestD) {
        bestD = d
        screener = m
      }
    }
    if (screener && onBall) {
      cands.push({
        orders: assemble(
          { kind: 'drive', to: { ...BASKET } },
          { playerId: screener.id, order: { kind: 'screen', to: { ...onBall.pos } } },
        ),
        bonus: 0,
        label: 'screen',
      })
    }
  }

  // Score every candidate by predictive rollout; the committed-continue line
  // carries its hysteresis bonus. Stable: first-listed wins exact ties.
  let best = cands[0]
  let bestV = -Infinity
  for (const c of cands) {
    const v = rolloutScore(state, side, c.orders, c.shoot) + c.bonus
    if (v > bestV) {
      bestV = v
      best = c
    }
  }
  // STUB plan-ahead (Q42/Q46): publish the chosen handler intent as a shallow
  // committed chain so the auto-run loop has something to fast-forward. The handler
  // is the only player given a chain here; off-ball spacing re-plans each step (P2
  // emits real multi-player chains).
  const orders = best.orders.map((o) =>
    o.playerId === handler.id ? { ...o, queue: stubChain(o.order) } : o,
  )
  return { orders, shoot: best.shoot }
}

// ---- Defense: positional man + help (reads positions only — Q16-legal) ------

/** Man up by matchup, switch on screens, drop the rim protector to wall the
 *  driving lane, and double a handler who's gotten open on the perimeter. This is
 *  pure positional reasoning off the revealed floor (never the opponent's hidden
 *  order), so it's Q16-legal as-is; the committed-route/rollout machinery is the
 *  offense's job (defense reacts, it doesn't build momentum lines). */
function planDefense(state: GameState, side: Side): AiPlan {
  const ai = state.players.filter((p) => p.side === side)
  const opp = state.players.filter((p) => p.side === opponentOf(side))
  const orders: { playerId: string; order: Order }[] = []

  for (let i = 0; i < ai.length; i++) {
    orders.push({ playerId: ai[i].id, order: { kind: 'guard', markId: opp[i].id } })
  }
  // Screen defense: a defender hung up on a pick hands his man to the nearest free
  // teammate (a switch), so a screen can't farm a free man every possession.
  for (let i = 0; i < ai.length; i++) {
    if (ai[i].stuck <= 0) continue
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < ai.length; j++) {
      if (j === i || ai[j].stuck > 0) continue
      const dd = dist(ai[j].pos, opp[i].pos)
      if (dd < bestD) {
        bestD = dd
        best = j
      }
    }
    if (best >= 0) {
      orders[i] = { playerId: ai[i].id, order: { kind: 'guard', markId: opp[best].id } }
      orders[best] = { playerId: ai[best].id, order: { kind: 'guard', markId: opp[i].id } }
    }
  }

  const handler = opp.find((p) => p.id === state.ballHandlerId)
  if (handler) {
    const open = openness(state.players, handler)
    const rimD = distToRim(handler.pos)
    const primaryIdx = opp.findIndex((o) => o.id === handler.id)

    // The rim protector (best interior D, off a non-shooter) anchors the paint.
    let rimProtIdx = -1
    let bestInt = -Infinity
    for (let i = 0; i < ai.length; i++) {
      if (i === primaryIdx) continue
      if (ai[i].attr.interiorD > bestInt) {
        bestInt = ai[i].attr.interiorD
        rimProtIdx = i
      }
    }
    const rimMan = rimProtIdx >= 0 ? opp[rimProtIdx] : null
    const canDrop = rimMan && (rimMan.attr.shooting < 58 || distToRim(rimMan.pos) < HELP_PAINT_RADIUS)
    if (rimProtIdx >= 0 && canDrop && rimD < MAX_SHOT_RANGE * 0.85) {
      // A FIXED anchor in front of the rim — set, he stuffs a bull; chasing the
      // ball would put him on the move and get him bulled off the spot.
      const plant = clampToCourt({ x: BASKET.x, y: BASKET.y + RIM_RADIUS - 2 })
      orders[rimProtIdx] =
        dist(ai[rimProtIdx].pos, plant) > 2
          ? { playerId: ai[rimProtIdx].id, order: { kind: 'help', to: plant } }
          : { playerId: ai[rimProtIdx].id, order: { kind: 'idle' } }
    }

    if (open > 0.6 && rimD < MAX_SHOT_RANGE * 0.7) {
      // Open on the perimeter: send a second body, pulled off the least dangerous
      // man (lowest shooting × openness).
      let helperIdx = -1
      let leastDanger = Infinity
      for (let i = 0; i < opp.length; i++) {
        if (i === primaryIdx) continue
        const danger = opp[i].attr.shooting + openness(state.players, opp[i]) * 30
        if (danger < leastDanger) {
          leastDanger = danger
          helperIdx = i
        }
      }
      if (helperIdx >= 0) {
        orders[helperIdx] = { playerId: ai[helperIdx].id, order: { kind: 'double', markId: handler.id } }
      }
    }

    // COMMITTED CUTOFF (Q9). When the handler is driving a committed line — read
    // off his REVEALED motion (sprintSpeed/sprintDir set LAST step by the engine,
    // never his hidden this-step order, so Q16-legal) and pointed rim-ward — the
    // on-ball defender stops trailing (you can't out-run a built-up sprint from
    // behind) and SPRINTS to a GOAL-SIDE chokepoint on his lane to the rim, then
    // HOLDS. The plant point is anchored toward the rim (a fixed spot the driver is
    // heading INTO), not a spot that recedes ahead of him — so the defender can
    // actually beat him there, stop, and become the SET body the bull contest
    // favors (engine.driveCollision), forcing a stop/bail. He telegraphs himself
    // (the committed sprint costs the Q5 angle×speed tax to bail) — the intended
    // tradeoff. Gated to a real rim attack (inside the help band, not already AT the
    // rim) so the on-ball man only abandons the trail when walling the rim pays.
    const dir = handler.sprintDir
    if (
      primaryIdx >= 0 &&
      dir &&
      handler.sprintSpeed > CUTOFF_SPRINT_MIN &&
      rimD > RIM_RADIUS &&
      rimD < HELP_PAINT_RADIUS &&
      ai[primaryIdx].stuck <= 0
    ) {
      const toRim = unitTo(handler.pos, BASKET)
      const rimward = toRim ? dir.x * toRim.x + dir.y * toRim.y > CUTOFF_RIM_DOT : false
      if (rimward) {
        // A point CUTOFF_LEAD units goal-side of the handler, toward the rim — in
        // his lane, ahead of him, reachable. The engine auto-holds on arrival, so a
        // defender who beats him there is planted (SET) when the drive arrives.
        const spot = clampToCourt(stepToward(handler.pos, BASKET, CUTOFF_LEAD))
        orders[primaryIdx] = { playerId: ai[primaryIdx].id, order: { kind: 'help', to: spot, mode: 'sprint' } }
      }
    }

    // GAMBLE FOR THE STRIP (Q20). The handler's handle is LOOSE this step — he just
    // bulled through a body and exposed the ball (`handler.bull`, REVEALED last-step
    // state set by the collision path, never a hidden order, so Q16-legal). The
    // nearest defender on him lunges for the strip. This is a real risk/reward, not
    // a free button: the engine prices the steal high vs a loose handle
    // (GAMBLE_STEAL_LOOSE_BONUS) but a MISS leaves the gambler beaten — he
    // over-commits past the ball and is STUCK recovering, surrendering the on-ball
    // man entirely. That miss cost is brutal when you still had the drive contained,
    // so a smart defender only reaches when he has NOTHING TO LOSE: the loose-handle
    // handler has already bulled into a near-certain finish (inside GAMBLE_THREAT_RIM
    // of the rim). Then a miss costs ~nothing (he scores anyway) while a strip denies
    // the bucket and flips possession — an EV-positive gamble, not a coin-flip bail.
    // Overrides the cutoff: stripping the exposed ball beats walling it.
    if (handler.bull > 0 && distToRim(handler.pos) < GAMBLE_THREAT_RIM) {
      let gIdx = -1
      let gd = GAMBLE_RANGE
      for (let i = 0; i < ai.length; i++) {
        if (ai[i].stuck > 0) continue // already hung up — can't lunge
        const d = dist(ai[i].pos, handler.pos)
        if (d < gd) {
          gd = d
          gIdx = i
        }
      }
      if (gIdx >= 0) orders[gIdx] = { playerId: ai[gIdx].id, order: { kind: 'steal', markId: handler.id } }
    }
  }
  return { orders }
}

/**
 * The CPU floor general. Pure: reads the REVEALED (last-step) state, returns
 * orders for its five (and, on offense, an optional shot). On offense it commits
 * an intent and selects it by predictive rollout (planOffense); on defense it
 * plays positional man + help (planDefense). Inside a rollout it short-circuits
 * to the cheap persist policy (so the reducer's own aiPlan call can't recurse).
 */
export function aiPlan(state: GameState, side: Side = 'ai'): AiPlan {
  if (rolloutDepth > 0) return persistPlan(state, side)
  if (state.offense === side) return planOffense(state, side)
  return planDefense(state, side)
}
