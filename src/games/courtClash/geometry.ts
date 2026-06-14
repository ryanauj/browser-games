import {
  BASE_STEP,
  BASKET,
  BURST_FACTOR,
  COURT_H,
  COURT_W,
  MAX_SHOT_RANGE,
  OPEN_DISTANCE,
  RIM_RADIUS,
  SPEED_STEP_BONUS,
  STAMINA_REACH_MIN,
  THREE_PT_RADIUS,
} from './constants'
import type { Player, Side, Vec } from './types'

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Floor units a player can cover in one beat. Driven by speed, then scaled
 *  continuously by stamina (so fatigue is always felt, not just past a cliff).
 *  The single source of truth for movement, the reach ring, and drag clamping. */
export function reachOf(p: Player, burst = false): number {
  const base = BASE_STEP + (p.attr.speed / 99) * SPEED_STEP_BONUS
  const staminaFactor = STAMINA_REACH_MIN + (1 - STAMINA_REACH_MIN) * (p.stamina / 100)
  return base * staminaFactor * (burst ? BURST_FACTOR : 1)
}

export function distToRim(p: Vec): number {
  return dist(p, BASKET)
}

export function clampToCourt(p: Vec): Vec {
  return {
    x: Math.max(2, Math.min(COURT_W - 2, p.x)),
    y: Math.max(2, Math.min(COURT_H - 2, p.y)),
  }
}

/** Step `from` toward `to` by at most `step` units; returns the new point. */
export function stepToward(from: Vec, to: Vec, step: number): Vec {
  const d = dist(from, to)
  if (d <= step || d === 0) return { ...to }
  const t = step / d
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

/** Perpendicular distance from point p to the segment a→b. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + abx * t, y: a.y + aby * t })
}

export function shotType(from: Vec): 'layup' | 'two' | 'three' {
  const d = distToRim(from)
  if (d <= RIM_RADIUS) return 'layup'
  // Corner threes sit closer to the rim than the arc up top — model the real
  // shape: near the baseline and out by the sideline counts as a three.
  const inCorner = from.y <= 16 && (from.x <= 14 || from.x >= COURT_W - 14)
  return d > THREE_PT_RADIUS || inCorner ? 'three' : 'two'
}

export function shotPoints(from: Vec): number {
  return shotType(from) === 'three' ? 3 : 2
}

export const opponentOf = (side: Side): Side => (side === 'player' ? 'ai' : 'player')

export function teammates(players: Player[], side: Side): Player[] {
  return players.filter((p) => p.side === side)
}

export function nearestOpponent(players: Player[], p: Player): Player | null {
  let best: Player | null = null
  let bestD = Infinity
  for (const o of players) {
    if (o.side === p.side) continue
    const d = dist(o.pos, p.pos)
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return best
}

/** Distance from a player to their nearest defender (opponent). */
export function nearestDefenderDist(players: Player[], p: Player): number {
  const d = nearestOpponent(players, p)
  return d ? dist(d.pos, p.pos) : OPEN_DISTANCE * 2
}

/** Openness 0..1 of a player: how far the nearest defender is, with a penalty
 *  if that defender sits between the player and the rim (a real contest). */
export function openness(players: Player[], shooter: Player): number {
  const def = nearestOpponent(players, shooter)
  if (!def) return 1
  const d = dist(def.pos, shooter.pos)
  let open = Math.max(0, Math.min(1, d / OPEN_DISTANCE))
  // Defender between shooter and rim contests harder.
  const contestPath = distToSegment(def.pos, shooter.pos, BASKET)
  if (contestPath < 8) open *= 0.68 + 0.32 * Math.min(1, contestPath / 8)
  return Math.max(0, Math.min(1, open))
}

/** How far past the shot's effective range (0 in range, →1 at a heave). */
export function rangePenalty(from: Vec): number {
  const d = distToRim(from)
  return Math.max(0, Math.min(1, (d - THREE_PT_RADIUS) / (MAX_SHOT_RANGE - THREE_PT_RADIUS)))
}
