import { reachOf } from './geometry'
import type { Action, GameState, Order } from './types'

/** A compact snapshot of one step — enough to eyeball positions, stamina,
 *  reach and orders without dumping the whole engine. */
export interface DebugFrame {
  step: number
  possession: number
  offense: string
  shotClock: number
  score: { player: number; ai: number }
  ball: string | null
  events: string[]
  players: {
    id: string
    side: string
    pos: { x: number; y: number }
    sta: number
    reach: number
    order: string
  }[]
}

/** The full debug artifact: seed + actions (for exact replay) + frames. */
export interface DebugLog {
  seed: number
  actions: Action[]
  frames: DebugFrame[]
}

const r1 = (n: number) => Math.round(n * 10) / 10

function orderLabel(o: Order): string {
  switch (o.kind) {
    case 'move':
      return `move${o.mode === 'sprint' ? '⚡' : ''}→(${r1(o.to.x)},${r1(o.to.y)})`
    case 'cut':
    case 'drive':
    case 'help':
    case 'screen':
      return `${o.kind}→(${r1(o.to.x)},${r1(o.to.y)})`
    case 'pass':
      return `pass→${o.toId}`
    case 'guard':
    case 'double':
    case 'steal':
      return `${o.kind}→${o.markId}`
    case 'idle':
      return 'idle'
  }
  return 'idle'
}

export function captureFrame(s: GameState): DebugFrame {
  return {
    step: s.step,
    possession: s.possession,
    offense: s.offense,
    shotClock: s.shotClock,
    score: { ...s.score },
    ball: s.ballHandlerId,
    events: s.events.map((e) => e.text),
    players: s.players.map((p) => ({
      id: p.id,
      side: p.side,
      pos: { x: r1(p.pos.x), y: r1(p.pos.y) },
      sta: Math.round(p.stamina),
      reach: r1(reachOf(p)),
      order: orderLabel(p.order),
    })),
  }
}
