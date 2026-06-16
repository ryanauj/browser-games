import {
  BASKET,
  HELP_PAINT_RADIUS,
  MAX_SHOT_RANGE,
  OPENNESS_SHOT_WEIGHT,
  RIM_RADIUS,
  SHOT_BASE,
  SHOT_STAT_WEIGHT,
} from './constants'
import { clampToCourt, dist, distToRim, distToSegment, nearestOpponent, openness, opponentOf, shotType } from './geometry'
import type { GameState, Order, Player, Side, Vec } from './types'

const statN = (v: number): number => (v - 50) / 49

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
  let ev = make * (type === 'three' ? 3 : 2)
  // Long-two tax: the settled mid-range jumper is the worst shot in basketball.
  // Discount it so the CPU prefers getting to the rim or kicking out for three.
  if (type === 'two' && distToRim(p.pos) > RIM_RADIUS + 6) ev *= 0.85
  return { ev, open }
}

export interface AiPlan {
  orders: { playerId: string; order: Order }[]
  /** If set (and the AI is on offense), the CPU pulls the trigger this beat. */
  shoot?: string
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
    orders.push({ playerId: p.id, order: arrived ? { kind: 'idle' } : { kind: 'move', to: spot } })
  }
  const dunk = clampToCourt(DUNKER_SPOT)
  orders.push({ playerId: big.id, order: dist(big.pos, dunk) < 2.5 ? { kind: 'idle' } : { kind: 'move', to: dunk } })
  return orders
}

/**
 * The CPU floor general. Pure: reads the state, returns orders for its five
 * (and, on offense, an optional shot). Heuristics kept legible and beatable:
 *  - Offense: shoot a good/forced look; else swing to a more open teammate;
 *    else attack the rim. Off-ball men relocate to get open.
 *  - Defense: man up by matchup; double the ball when the handler gets open,
 *    pulling the helper off the least dangerous man.
 */
export function aiPlan(state: GameState, side: Side = 'ai'): AiPlan {
  const ai = state.players.filter((p) => p.side === side)
  const opp = state.players.filter((p) => p.side === opponentOf(side))
  const orders: { playerId: string; order: Order }[] = []

  if (state.offense === side) {
    const handler = ai.find((p) => p.id === state.ballHandlerId)
    if (!handler) return { orders }

    const here = shotEV(handler, state.players)
    const d = distToRim(handler.pos)
    const inRange = d < MAX_SHOT_RANGE * 0.95
    // Is the rim walled? A HELP defender sitting in the lane near the basket means
    // charging in is a contested layup or a block — so the handler stops short to
    // pull up or kick. An unguarded rim (e.g. a static defense that never rotated a
    // protector over) gets attacked all the way for the finish. This ties the shot
    // mix to the defense: a help-and-recover defense forces jumpers, a flat-footed
    // one surrenders layups. The on-ball man doesn't count — he's always goal-side,
    // and beating him is the whole point of the drive.
    const onBall = nearestOpponent(state.players, handler)
    const rimWalled = opp.some(
      (o) =>
        o.id !== onBall?.id &&
        distToRim(o.pos) < RIM_RADIUS + 4 &&
        distToSegment(o.pos, handler.pos, BASKET) < RIM_RADIUS - 3,
    )
    const atRim = d <= (rimWalled ? RIM_RADIUS + 12 : RIM_RADIUS - 2)
    const mustShoot = state.shotClock <= 1
    // Late-clock urgency: rather than grind a stalling drive into a buzzer heave
    // from downtown (a near-0% three that craters the shot chart), take the best
    // look you can actually get to while still in range — but only in the last
    // beat or two, so it doesn't abandon a developing drive for an early jumper.
    const clockLow = state.shotClock <= 2
    // A driver whose man (or help) is draped on him is "pressured": he should
    // give up the rock to an open teammate rather than force into the contact.
    const pressured = here.open < 0.42

    // Off-ball men spread the floor so a kick always has somewhere to go.
    for (const o of spacingOrders(handler, state.players, ai)) orders.push(o)

    // The best release valve on the floor — found up front so every shot/drive
    // choice can weigh "give it up" against "take it myself".
    let bestMate: Player | null = null
    let bestMateEV = -Infinity
    let bestMateOpen = 0
    for (const m of ai) {
      if (m.id === handler.id) continue
      if (distToRim(m.pos) >= MAX_SHOT_RANGE) continue
      const mEV = shotEV(m, state.players)
      if (mEV.ev > bestMateEV) {
        bestMateEV = mEV.ev
        bestMate = m
        bestMateOpen = mEV.open
      }
    }
    // What the handler's own look is really worth once contact is priced in: a
    // smothered rim/jumper invites a block or a brick, so a draped handler values
    // his shot well below its raw EV — which is what tips him into the kick.
    const hereEff = here.ev * (0.5 + 0.5 * Math.min(1, here.open / 0.55))

    const needOpen = (shotType(handler.pos) === 'three' ? 0.5 : 0.4) - (clockLow ? 0.08 : 0)
    const goodLook = inRange && here.ev >= (clockLow ? 0.82 : 0.92) && here.open > needOpen

    // 1) Forced shot at the buzzer — take whatever you've got.
    if (mustShoot) {
      orders.push({ playerId: handler.id, order: { kind: 'idle' } })
      return { orders, shoot: handler.id }
    }

    // 2) Drive-and-kick FIRST: an open teammate three (≈1.2 pts) beats the
    //    handler's own pull-up two (≈0.9), so the swing is evaluated before the
    //    handler settles — when help rotates, the shooter it left is the best shot
    //    on the floor and the offense should find him. The kick must clearly beat
    //    the handler's (contact-discounted) look so he doesn't pass up a real
    //    advantage; a pressured handler gives it up more readily.
    const kickMargin = pressured ? 0.0 : clockLow ? 0.08 : 0.12
    // …but never pass up a point-blank/wide-open look of your own to do it.
    const ownLookGreat = inRange && here.open > 0.62 && here.ev >= 1.05
    if (!ownLookGreat && bestMate && bestMateOpen > 0.45 && bestMateEV >= hereEff + kickMargin) {
      orders.push({ playerId: handler.id, order: { kind: 'pass', toId: bestMate.id } })
      return { orders }
    }

    // 3) Take a genuinely good look for yourself (threes demand a real catch-and-
    //    shoot window; rim/mid looks fire more freely).
    if (goodLook) {
      orders.push({ playerId: handler.id, order: { kind: 'idle' } })
      return { orders, shoot: handler.id }
    }

    // 4) Nothing better on offer: attack ALL the way to the rim to collapse the D
    //    rather than settling for a long two. Pulling up mid-range is a last
    //    resort — only when the clock is winding down (better a contested two than
    //    a buzzer heave); otherwise keep driving to draw help and spring a kick.
    const settleNow = clockLow && inRange
    if (!atRim && !settleNow) {
      // Run a ball-screen as you attack, but only when the handler is actually
      // hemmed in — a tightly-guarded driver gets a pick from the nearest
      // teammate; an open driver just goes.
      const hDef = nearestOpponent(state.players, handler)
      if (hDef && here.open < 0.4) {
        let screener: Player | null = null
        let bestD = Infinity
        for (const m of ai) {
          if (m.id === handler.id) continue
          const dd = dist(m.pos, handler.pos)
          if (dd < bestD) {
            bestD = dd
            screener = m
          }
        }
        if (screener) {
          const pick: Order = { kind: 'screen', to: { ...hDef.pos }, markId: hDef.id }
          const idx = orders.findIndex((o) => o.playerId === screener!.id)
          if (idx >= 0) orders[idx].order = pick
          else orders.push({ playerId: screener.id, order: pick })
        }
      }
      orders.push({ playerId: handler.id, order: { kind: 'drive', to: { ...BASKET } } })
      return { orders }
    }
    orders.push({ playerId: handler.id, order: { kind: 'idle' } })
    return { orders, shoot: handler.id }
  }

  // ---- Defense: man up by matchup, then maybe double the ball. ----
  for (let i = 0; i < ai.length; i++) {
    orders.push({ playerId: ai[i].id, order: { kind: 'guard', markId: opp[i].id } })
  }
  // Screen defense: if a defender got hung up on a pick, the nearest free
  // teammate switches onto the man they were guarding so a screen can't leave
  // an attacker wide open (and can't be farmed for a free man every possession).
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

    // The rim protector (best interior D) is the low man — he anchors the paint
    // and shouldn't be the one yanked out to dig.
    let rimProtIdx = -1
    let bestInt = -Infinity
    for (let i = 0; i < ai.length; i++) {
      if (i === primaryIdx) continue
      if (ai[i].attr.interiorD > bestInt) {
        bestInt = ai[i].attr.interiorD
        rimProtIdx = i
      }
    }

    if (rimD < HELP_PAINT_RADIUS && open > 0.45) {
      // A driver beat his man into the paint. TWO things happen, and the offense
      // weighs both: (1) the rim protector slides over to wall the basket
      // (contesting the layup/dump-off), and (2) the nearest PERIMETER defender
      // digs at the ball — springing his man for a catch-and-shoot kick. The dig
      // is a stunt, not an abandonment (he sits between his man and the ball), so
      // he can recover to contest the three. Static man defense does neither, so a
      // non-rotating defense gives up the clean drive — which is what makes
      // guarding worth more than standing still.
      if (rimProtIdx >= 0) {
        const vx = handler.pos.x - BASKET.x
        const vy = handler.pos.y - BASKET.y
        const vlen = Math.hypot(vx, vy) || 1
        const spot = clampToCourt({
          x: BASKET.x + (vx / vlen) * (RIM_RADIUS - 2),
          y: BASKET.y + (vy / vlen) * (RIM_RADIUS - 2),
        })
        orders[rimProtIdx] = { playerId: ai[rimProtIdx].id, order: { kind: 'help', to: spot } }
      }
      // Nearest perimeter defender (not on-ball, not the rim anchor) stunts at the
      // driver, splitting the distance to his man so he can still close back out.
      // The dig pressures the drive and springs his man for a catch-and-shoot
      // kick; static man defense never stunts, so it gives the clean drive up.
      let digIdx = -1
      let bestD = Infinity
      for (let i = 0; i < opp.length; i++) {
        if (i === primaryIdx || i === rimProtIdx) continue
        const dd = dist(ai[i].pos, handler.pos)
        if (dd < bestD) {
          bestD = dd
          digIdx = i
        }
      }
      if (digIdx >= 0) {
        const dig = clampToCourt({
          x: ai[digIdx].pos.x + (handler.pos.x - ai[digIdx].pos.x) * 0.6,
          y: ai[digIdx].pos.y + (handler.pos.y - ai[digIdx].pos.y) * 0.6,
        })
        orders[digIdx] = { playerId: ai[digIdx].id, order: { kind: 'help', to: dig } }
      }
    } else if (open > 0.6 && rimD < MAX_SHOT_RANGE * 0.7) {
      // Open on the perimeter: send a second body at the ball, pulled off the
      // least dangerous man.
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
  }
  return { orders }
}
