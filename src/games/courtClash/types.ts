/** A lineup slot / natural role for an athlete. */
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C'

export type Side = 'player' | 'ai'

/**
 * deploy       — player is making plays under the shot clock
 * quarterBreak  — the game clock hit 0:00; waiting to tip off the next quarter
 * gameover      — a winner has been decided
 *
 * The brief clash "resolving" animation is a UI concern handled by the hook,
 * not a engine phase, so the reducer stays synchronous and pure.
 */
export type Phase = 'deploy' | 'quarterBreak' | 'gameover'

/** Passive athlete abilities (resolved by the engine). */
export type AbilityKey =
  | 'fastBreak' // +2 OFF when the opposing slot is empty
  | 'clutch' // +2 OFF while your score is high
  | 'hustle' // +1 OFF for each turn survived
  | 'anchor' // passive wall — flavour for high DEF
  | 'wall' // flavour for high DEF
  | 'rebound' // +1 STA each turn (up to max)
  | 'iron' // survives the first foul-out at 1 STA
  | 'playmaker' // +1 energy next turn while on court
  | 'takeover' // +1 OFF to allied lanes

/** One-shot power-up effects. */
export type EffectKey =
  | 'clutchGene' // +3 OFF to a target ally this clash
  | 'fastBreakEnergy' // +2 energy this turn
  | 'timeout' // restore a target ally to full stamina
  | 'techFoul' // deal 4 damage to a target enemy athlete
  | 'zoneDefense' // all your athletes +2 DEF this clash
  | 'fullCourtPress' // all enemy athletes -2 OFF this clash

export interface AthleteCard {
  id: string
  name: string
  kind: 'athlete'
  position: Position
  cost: number
  off: number
  def: number
  sta: number
  ability?: AbilityKey
  abilityText?: string
}

export interface PowerUpCard {
  id: string
  name: string
  kind: 'powerup'
  cost: number
  effect: EffectKey
  target: 'ally' | 'enemy' | 'self' | 'none'
  text: string
}

export type Card = AthleteCard | PowerUpCard

/** An athlete deployed on the court. */
export interface BoardAthlete {
  /** Unique per deployed instance (so duplicates of a card are distinct). */
  uid: string
  card: AthleteCard
  slot: Position
  sta: number
  turnsSurvived: number
  /** One-shot OFF/DEF buffs applied by power-ups, cleared after each clash. */
  clashOff: number
  clashDef: number
  /** Whether the Iron save has already been used. */
  ironUsed: boolean
}

export type Lineup = Record<Position, BoardAthlete | null>

export interface PlayerState {
  side: Side
  deck: Card[]
  hand: Card[]
  lineup: Lineup
  energy: number
  score: number
}

export interface GameState {
  turn: number
  quarter: number
  phase: Phase
  /** Fiction seconds left in the current quarter. */
  gameClock: number
  players: Record<Side, PlayerState>
  seed: number
  /** PRNG cursor — advanced by the engine so randomness is reproducible. */
  rngState: number
  log: string[]
  winner?: Side | 'tie'
}

export type Action =
  | { type: 'PLAY_ATHLETE'; cardId: string; slot: Position }
  | { type: 'PLAY_POWERUP'; cardId: string; targetSide?: Side; targetSlot?: Position }
  | { type: 'END_POSSESSION' }
  | { type: 'ADVANCE_QUARTER' }
  | { type: 'NEW_GAME'; seed?: number }
