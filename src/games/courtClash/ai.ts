import { BASKET, MAX_SHOT_RANGE, RIM_RADIUS } from './constants'
import { clampToCourt, distToRim, nearestOpponent, openness } from './geometry'
import type { GameState, Order, Player, Vec } from './types'

export interface AiPlan {
  orders: { playerId: string; order: Order }[]
  /** If set (and the AI is on offense), the CPU pulls the trigger this beat. */
  shoot?: string
}

/** Relocate an off-ball player to widen separation from their defender — the
 *  CPU's way of getting open. Deterministic (no RNG) so the reducer stays pure. */
function offBallOrder(p: Player, players: Player[]): Order {
  const def = nearestOpponent(players, p)
  if (!def) return { kind: 'idle' }
  const dx = p.pos.x - def.pos.x
  const dy = p.pos.y - def.pos.y
  const len = Math.hypot(dx, dy) || 1
  const to: Vec = clampToCourt({ x: p.pos.x + (dx / len) * 9, y: p.pos.y + (dy / len) * 9 })
  return { kind: 'move', to }
}

/**
 * The CPU floor general. Pure: reads the state, returns orders for its five
 * (and, on offense, an optional shot). Heuristics kept legible and beatable:
 *  - Offense: shoot a good/forced look; else swing to a more open teammate;
 *    else attack the rim. Off-ball men relocate to get open.
 *  - Defense: man up by matchup; double the ball when the handler gets open,
 *    pulling the helper off the least dangerous man.
 */
export function aiPlan(state: GameState): AiPlan {
  const ai = state.players.filter((p) => p.side === 'ai')
  const opp = state.players.filter((p) => p.side === 'player')
  const orders: { playerId: string; order: Order }[] = []

  if (state.offense === 'ai') {
    const handler = ai.find((p) => p.id === state.ballHandlerId)
    if (!handler) return { orders }

    const open = openness(state.players, handler)
    const d = distToRim(handler.pos)
    const inRange = d < MAX_SHOT_RANGE * 0.72
    const mustShoot = state.shotClock <= 1
    const goodLook = (open > 0.6 && inRange) || (open > 0.42 && d < RIM_RADIUS + 5)

    // Off-ball men work to get open regardless of the handler's choice.
    for (const p of ai) {
      if (p.id === handler.id) continue
      orders.push({ playerId: p.id, order: offBallOrder(p, state.players) })
    }

    if (mustShoot || goodLook) {
      orders.push({ playerId: handler.id, order: { kind: 'idle' } })
      return { orders, shoot: handler.id }
    }

    // Swing to a meaningfully more open teammate in scoring range.
    let bestMate: Player | null = null
    let bestOpen = open + 0.16
    for (const m of ai) {
      if (m.id === handler.id) continue
      const mo = openness(state.players, m)
      if (mo > bestOpen && distToRim(m.pos) < MAX_SHOT_RANGE) {
        bestOpen = mo
        bestMate = m
      }
    }
    orders.push({
      playerId: handler.id,
      order: bestMate ? { kind: 'pass', toId: bestMate.id } : { kind: 'drive', to: { ...BASKET } },
    })
    return { orders }
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
