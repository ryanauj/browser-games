// Court Clash 2.0 — "The Floor General". Real-time, beat-by-beat half-court
// 5v5. See SPEC.md for the full design. The engine is a pure reducer over
// discrete beats; the hook animates between beat snapshots.

export type Side = 'player' | 'ai'

/** play — a possession is live. gameover — someone reached the win target. */
export type Phase = 'play' | 'gameover'

/** A point on the logical floor. X is 0..100 left→right, Y is 0..100 from the
 *  baseline/basket end (small Y, near the rim) to half-court (Y=100). */
export interface Vec {
  x: number
  y: number
}

/** The eight sim attributes (0..99). Never shown as a stat line during play —
 *  they feed the risk glow and the contest math. */
export interface Attributes {
  speed: number
  handle: number
  finishing: number
  shooting: number
  passing: number
  strength: number
  perimeterD: number
  interiorD: number
}

/** A player's standing order. Persists across beats until the coach changes it.
 *  One-shot orders (pass, shoot) clear themselves once resolved. */
export type Order =
  // offense
  | { kind: 'idle' }
  | { kind: 'move'; to: Vec } // relocate / spot up (jog)
  | { kind: 'cut'; to: Vec } // hard cut toward a spot (costs stamina)
  | { kind: 'drive'; to: Vec } // ball handler attacks toward a point
  | { kind: 'screen'; to: Vec; markId?: string } // set a pick; with markId, track that defender (a body, not a spot)
  | { kind: 'pass'; toId: string; lead?: Vec } // one-shot pass; lead = aimed catch spot for a cutter
  // defense
  | { kind: 'guard'; markId: string } // man-to-man (default)
  | { kind: 'double'; markId: string } // send a second defender at the ball
  | { kind: 'help'; to: Vec } // rotate to a spot / fill a gap
  | { kind: 'steal'; markId: string } // gamble for a strip/pick (high risk)

export type OrderKind = Order['kind']

export interface Player {
  id: string
  side: Side
  name: string
  number: number
  role: string // flavor tag derived from attributes (Slasher, Lockdown, …)
  attr: Attributes
  pos: Vec
  stamina: number // 0..100
  order: Order
  /** Beats remaining slowed by a screen (a defender stuck on a pick). */
  stuck: number
  /** Beats the player has been setting the current screen (frees after ~2). */
  screenHeld: number
  /** Beats remaining of a post-drive finishing boost on the next shot. */
  primed: number
}

/** Transient outcome of the most recent beat/shot, for the UI to animate. */
export interface BeatEvent {
  kind:
    | 'pass'
    | 'steal'
    | 'shotMake'
    | 'shotMiss'
    | 'block'
    | 'rebound'
    | 'turnover'
    | 'shotclock'
    | 'stall'
  from?: Vec
  to?: Vec
  by?: string // player id
  points?: number
  text: string
}

export interface GameState {
  phase: Phase
  players: Player[]
  ballHandlerId: string | null // who has the ball
  offense: Side // which side is on offense
  shotClock: number // beats remaining this possession
  score: Record<Side, number>
  possession: number // possession counter (animation reset key)
  beat: number // beat counter within the game
  winTarget: number
  seed: number
  rngState: number
  events: BeatEvent[] // events from the last resolution (for juice + log)
  log: string[]
  winner?: Side
}

export type Action =
  | { type: 'SET_ORDER'; playerId: string; order: Order }
  | { type: 'RUN_BEAT' }
  | { type: 'CALL_SHOT'; playerId: string }
  | { type: 'NEW_GAME'; seed?: number }
