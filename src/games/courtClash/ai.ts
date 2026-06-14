import {
  BASKET,
  MAX_SHOT_RANGE,
  OPENNESS_SHOT_WEIGHT,
  RIM_RADIUS,
  SHOT_BASE,
  SHOT_STAT_WEIGHT,
  THREE_PT_RADIUS,
} from './constants'
import { clampToCourt, distToRim, nearestOpponent, openness, opponentOf, shotType } from './geometry'
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
  return { ev: make * (type === 'three' ? 3 : 2), open }
}

export interface AiPlan {
  orders: { playerId: string; order: Order }[]
  /** If set (and the AI is on offense), the CPU pulls the trigger this beat. */
  shoot?: string
}

/** Relocate an off-ball player to widen separation from their defender — the
 *  CPU's way of getting open. Deterministic (no RNG) so the reducer stays pure. */
function offBallOrder(p: Player, players: Player[]): Order {
  const def = nearestOpponent(players, p)
  // Step away from the nearest defender to create separation.
  let to: Vec = { ...p.pos }
  if (def) {
    const dx = p.pos.x - def.pos.x
    const dy = p.pos.y - def.pos.y
    const len = Math.hypot(dx, dy) || 1
    to = { x: p.pos.x + (dx / len) * 9, y: p.pos.y + (dy / len) * 9 }
  }
  // Role-aware spacing: shooters drift out to the arc (so catch-and-shoot threes
  // exist), while non-shooters stay inside as rim/mid threats. This keeps the
  // floor spread without turning all five into perimeter chuckers.
  const isShooter = p.attr.shooting > 60
  const rimDx = to.x - BASKET.x
  const rimDy = to.y - BASKET.y
  const rimDist = Math.hypot(rimDx, rimDy) || 1
  if (isShooter && rimDist < THREE_PT_RADIUS - 2) {
    const want = THREE_PT_RADIUS + 1
    to = { x: BASKET.x + (rimDx / rimDist) * want, y: BASKET.y + (rimDy / rimDist) * want }
  }
  return { kind: 'move', to: clampToCourt(to) }
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
    const mustShoot = state.shotClock <= 1

    // Off-ball men work to get open / space the floor regardless of the choice.
    for (const p of ai) {
      if (p.id === handler.id) continue
      orders.push({ playerId: p.id, order: offBallOrder(p, state.players) })
    }

    // 1) Take a genuinely good look now (or when the clock forces it). Threes
    //    demand a real catch-and-shoot window; rim/mid looks fire more freely.
    const needOpen = shotType(handler.pos) === 'three' ? 0.5 : 0.4
    const goodLook = inRange && here.ev >= 0.92 && here.open > needOpen
    if (mustShoot || goodLook) {
      orders.push({ playerId: handler.id, order: { kind: 'idle' } })
      return { orders, shoot: handler.id }
    }

    // 2) Swing to a teammate with a clearly better look (worth the pass risk).
    let bestMate: Player | null = null
    let bestMateEV = here.ev + 0.15
    for (const m of ai) {
      if (m.id === handler.id) continue
      const mEV = shotEV(m, state.players)
      if (mEV.ev > bestMateEV && distToRim(m.pos) < MAX_SHOT_RANGE) {
        bestMateEV = mEV.ev
        bestMate = m
      }
    }
    if (bestMate) {
      orders.push({ playerId: handler.id, order: { kind: 'pass', toId: bestMate.id } })
      return { orders }
    }

    // 3) Nothing better on offer: attack from outside to collapse the D, but
    //    once you're in scoring range just take the shot — don't pass-loop into
    //    a turnover or stall the possession.
    if (d > RIM_RADIUS + 12) {
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
  const handler = opp.find((p) => p.id === state.ballHandlerId)
  if (handler) {
    const open = openness(state.players, handler)
    if (open > 0.6 && distToRim(handler.pos) < MAX_SHOT_RANGE * 0.7) {
      const primaryIdx = opp.findIndex((o) => o.id === handler.id)
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
