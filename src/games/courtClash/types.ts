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

/** Jog = flat, reactive, no momentum (cheap to re-aim). Sprint = commit a
 *  target, accelerate along the line, telegraphed, pay an angle×speed penalty to
 *  bail (Q13). */
export type MoveMode = 'jog' | 'sprint'

/** A player's standing order. Persists across steps until the coach changes it.
 *  A movement order moves toward its target each step and HOLDS on arrival (Q12).
 *  One-shot orders (pass, shoot) clear themselves once resolved. */
export type Order =
  // offense
  | { kind: 'idle' }
  | { kind: 'move'; to: Vec; mode: MoveMode } // relocate (jog) or committed sprint (Q13)
  | { kind: 'cut'; to: Vec } // off-ball hard cut — always sprint (a move/sprint specialization)
  | { kind: 'drive'; to: Vec } // ball handler attacks — always sprint (carries collision/strip/prime)
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
  /** Current sprint speed in floor-units/step (Q4 accel ramp), 0 when jogging/
   *  idle. Serialized so sub-steps replay exactly; read pre-contact as the bull
   *  momentum term (Q22). Builds while sprinting toward an unchanged target;
   *  reset by a bail (Q24) and on arrival/stop. */
  sprintSpeed: number
  /** Unit heading the current sprint speed was built along, or null when not
   *  sprinting. Used to price the angle×speed redirect cost on a bail (Q5). */
  sprintDir: Vec | null
  /** Steps remaining slowed by a screen (a defender stuck on a pick). */
  stuck: number
  /** Steps the player has been setting the current screen (frees after a bit). */
  screenHeld: number
  /** Steps remaining of a post-drive finishing boost on the next shot. */
  primed: number
  /** Steps remaining of a "loose handle" after bulling through a body — the
   *  driver shoved a man off his spot but exposed the ball (higher strip risk). */
  bull: number
}

/** A ball traveling on its own over steps (Q18) — a pass in flight (and, when a
 *  shot is modeled as a flight, a launched shot). While a ball exists,
 *  `ballHandlerId` is null: nobody holds it, so any code that keyed off a non-null
 *  handler must treat that as a valid in-flight state. ALL fields are serialized
 *  in `GameState`, so an in-flight pass replays byte-identical (the hard gate).
 *
 *  This is the FROZEN contract UI/AI build on. The shape:
 *   - `pos`      current floor position of the ball this step.
 *   - `vel`      velocity (heading × speed) in floor-units/step; re-oriented each
 *                step toward `to` for a homing direct pass, fixed for a lead.
 *   - `from`     the release point (passer/shooter spot at launch) — for the UI's
 *                flight render and the post-resolution event stamp.
 *   - `fromId`   who released it (passer / shooter).
 *   - `targetId` intended receiver (a player id), or null for a pure lead-to-spot.
 *   - `to`       the aim point: the receiver's spot (re-aimed each step for a
 *                direct pass) or a fixed lead point / the rim (shot).
 *   - `kind`     'pass' (thrown to a teammate) | 'shot' (launched at the rim).
 *   - `lead`     true = a lead pass to a fixed `to` spot (a cutter runs onto it);
 *                false = a direct pass that homes to the receiver each step.
 *   - `steps`    steps in flight so far (for the errant-pass timeout). */
export interface Ball {
  pos: Vec
  vel: Vec
  from: Vec
  fromId: string
  targetId: string | null
  to: Vec
  kind: 'pass' | 'shot'
  lead: boolean
  steps: number
}

/** A shot in its windup (Q17): the shooter has committed and is rooted, gathering
 *  for `release` more steps before the ball goes up. The defense can close and
 *  contest DURING the gather; make%/block are read at release against where the
 *  defenders ended up. Serialized so the windup replays exactly. */
export interface ShotGather {
  shooterId: string
  release: number
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
  ballHandlerId: string | null // who has the ball (null while a ball is in flight)
  ball: Ball | null // a pass/shot traveling on its own (Q18); null = held/none
  gather: ShotGather | null // a shot in its windup (Q17); null = no shot gathering
  offense: Side // which side is on offense
  shotClock: number // STEPS remaining this possession (Q10)
  score: Record<Side, number>
  possession: number // possession counter (animation reset key)
  step: number // step counter within the game (was `beat`; Q10)
  winTarget: number
  seed: number
  rngState: number
  events: BeatEvent[] // events from the last resolution (for juice + log)
  log: string[]
  winner?: Side
}

export type Action =
  | { type: 'SET_ORDER'; playerId: string; order: Order }
  | { type: 'RUN_STEP' } // advance exactly one step (Q10/Q11)
  | { type: 'CALL_SHOT'; playerId: string }
  | { type: 'NEW_GAME'; seed?: number }
