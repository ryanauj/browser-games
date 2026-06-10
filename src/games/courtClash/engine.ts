import {
  DECK_SIZE,
  DRAW_PER_TURN,
  ENERGY_PER_TURN,
  FIT_BONUS,
  HAND_CAP,
  MAX_ENERGY,
  MISMATCH_PENALTY,
  OPENING_HAND,
  POSITIONS,
  POSSESSION_GAME_SECONDS_MAX,
  POSSESSION_GAME_SECONDS_MIN,
  QUARTER_GAME_SECONDS,
  QUARTERS,
  STARTING_ENERGY,
  THREE_POINT_MARGIN,
} from './constants'
import { ATHLETES, POWER_UPS } from './cards'
import { nextInt, shuffle } from './rng'
import type {
  Action,
  AthleteCard,
  BoardAthlete,
  Card,
  GameState,
  Lineup,
  PlayerState,
  Position,
  Side,
} from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function emptyLineup(): Lineup {
  return { PG: null, SG: null, SF: null, PF: null, C: null }
}

/** Base energy for a given turn number (before per-card bonuses). */
function energyForTurn(turn: number): number {
  return Math.min(MAX_ENERGY, STARTING_ENERGY + (turn - 1) * ENERGY_PER_TURN)
}

/**
 * Build a shuffled deck for one side. Each athlete/power-up template is
 * stamped into a few copies, given side-unique instance ids, then shuffled
 * and trimmed to DECK_SIZE.
 */
function buildDeck(side: Side, state: number): [Card[], number] {
  const copies: Card[] = []
  let counter = 0
  const stamp = (card: Card, times: number) => {
    for (let i = 0; i < times; i++) {
      copies.push({ ...card, id: `${side}-${card.id}#${counter++}` } as Card)
    }
  }
  ATHLETES.forEach((a) => stamp(a, 2))
  POWER_UPS.forEach((p) => stamp(p, 2))

  const [shuffled, next] = shuffle(copies, state)
  return [shuffled.slice(0, DECK_SIZE), next]
}

/** Draw up to `n` cards from the top of the deck, respecting the hand cap. */
function draw(player: PlayerState, n: number): PlayerState {
  const room = Math.max(0, HAND_CAP - player.hand.length)
  const count = Math.min(n, room, player.deck.length)
  if (count === 0) return player
  return {
    ...player,
    hand: [...player.hand, ...player.deck.slice(0, count)],
    deck: player.deck.slice(count),
  }
}

function createPlayer(side: Side, deck: Card[]): PlayerState {
  const base: PlayerState = {
    side,
    deck,
    hand: [],
    lineup: emptyLineup(),
    energy: 0,
    score: 0,
  }
  return draw(base, OPENING_HAND)
}

export function createInitialState(seed: number = Date.now()): GameState {
  let s = seed | 0
  let playerDeck: Card[]
  let aiDeck: Card[]
  ;[playerDeck, s] = buildDeck('player', s)
  ;[aiDeck, s] = buildDeck('ai', s)

  const player = createPlayer('player', playerDeck)
  const ai = createPlayer('ai', aiDeck)
  const energy = energyForTurn(1)

  return {
    turn: 1,
    quarter: 1,
    phase: 'deploy',
    gameClock: QUARTER_GAME_SECONDS,
    players: {
      player: { ...player, energy },
      ai: { ...ai, energy },
    },
    seed,
    rngState: s,
    log: ['Tip-off! Q1 is underway.'],
    winner: undefined,
  }
}

// ---------------------------------------------------------------------------
// Stat math
// ---------------------------------------------------------------------------

/** Positional fit modifiers: on-position rewards, off-position penalises. */
export function fitMods(card: AthleteCard, slot: Position): { off: number; def: number } {
  const onPosition = card.position === slot
  const delta = onPosition ? FIT_BONUS : -MISMATCH_PENALTY
  return { off: delta, def: delta }
}

function countAbility(lineup: Lineup, ability: string): number {
  let n = 0
  for (const pos of POSITIONS) {
    const a = lineup[pos]
    if (a && a.card.ability === ability) n++
  }
  return n
}

/** Effective offense for an athlete during a clash. */
export function effectiveOff(
  ath: BoardAthlete,
  owner: PlayerState,
  opposingEmpty: boolean,
  lateGame: boolean,
): number {
  let off = ath.card.off + fitMods(ath.card, ath.slot).off + ath.clashOff
  if (ath.card.ability === 'hustle') off += ath.turnsSurvived
  if (ath.card.ability === 'fastBreak' && opposingEmpty) off += 2
  if (ath.card.ability === 'clutch' && lateGame) off += 2
  // Takeover boosts other allies, so count takeover athletes other than self.
  const takeovers = countAbility(owner.lineup, 'takeover')
  const selfTakeover = ath.card.ability === 'takeover' ? 1 : 0
  off += takeovers - selfTakeover
  return Math.max(0, off)
}

/** Effective defense for an athlete during a clash. */
export function effectiveDef(ath: BoardAthlete): number {
  const def = ath.card.def + fitMods(ath.card, ath.slot).def + ath.clashDef
  return Math.max(0, def)
}

// ---------------------------------------------------------------------------
// Plays (used by both the player UI and the AI)
// ---------------------------------------------------------------------------

let uidCounter = 0
function nextUid(): string {
  return `b${uidCounter++}`
}

function findInHand(player: PlayerState, cardId: string): Card | undefined {
  return player.hand.find((c) => c.id === cardId)
}

function removeFromHand(player: PlayerState, cardId: string): Card[] {
  return player.hand.filter((c) => c.id !== cardId)
}

/** Deploy an athlete from hand into a slot. Returns unchanged state if illegal. */
export function playAthlete(
  state: GameState,
  side: Side,
  cardId: string,
  slot: Position,
): GameState {
  const player = state.players[side]
  const card = findInHand(player, cardId)
  if (!card || card.kind !== 'athlete') return state
  if (player.lineup[slot]) return state // slot occupied
  if (card.cost > player.energy) return state

  const deployed: BoardAthlete = {
    uid: nextUid(),
    card,
    slot,
    sta: card.sta,
    turnsSurvived: 0,
    clashOff: 0,
    clashDef: 0,
    ironUsed: false,
  }
  const updated: PlayerState = {
    ...player,
    energy: player.energy - card.cost,
    hand: removeFromHand(player, cardId),
    lineup: { ...player.lineup, [slot]: deployed },
  }
  return {
    ...state,
    players: { ...state.players, [side]: updated },
    log: [`${labelFor(side)} sends ${card.name} to ${slot}.`, ...state.log],
  }
}

/** Play a power-up. Some need a target slot/side. Returns unchanged if illegal. */
export function playPowerUp(
  state: GameState,
  side: Side,
  cardId: string,
  targetSide?: Side,
  targetSlot?: Position,
): GameState {
  const player = state.players[side]
  const card = findInHand(player, cardId)
  if (!card || card.kind !== 'powerup') return state
  if (card.cost > player.energy) return state

  const oppSide: Side = side === 'player' ? 'ai' : 'player'
  let players = { ...state.players }
  let me: PlayerState = { ...player, energy: player.energy - card.cost, hand: removeFromHand(player, cardId) }
  let opp: PlayerState = { ...state.players[oppSide] }
  let logLine = `${labelFor(side)} plays ${card.name}.`

  const mutateAthlete = (
    p: PlayerState,
    slot: Position,
    fn: (a: BoardAthlete) => BoardAthlete,
  ): PlayerState => {
    const a = p.lineup[slot]
    if (!a) return p
    return { ...p, lineup: { ...p.lineup, [slot]: fn(a) } }
  }

  switch (card.effect) {
    case 'fastBreakEnergy':
      me = { ...me, energy: me.energy + 2 }
      break
    case 'clutchGene': {
      if (targetSlot && me.lineup[targetSlot]) {
        me = mutateAthlete(me, targetSlot, (a) => ({ ...a, clashOff: a.clashOff + 3 }))
        logLine += ` ${me.lineup[targetSlot]!.card.name} gets +3 OFF.`
      } else return state // requires a valid ally target
      break
    }
    case 'timeout': {
      if (targetSlot && me.lineup[targetSlot]) {
        me = mutateAthlete(me, targetSlot, (a) => ({ ...a, sta: a.card.sta }))
      } else return state
      break
    }
    case 'zoneDefense':
      me = buffLineup(me, (a) => ({ ...a, clashDef: a.clashDef + 2 }))
      break
    case 'fullCourtPress':
      opp = buffLineup(opp, (a) => ({ ...a, clashOff: a.clashOff - 2 }))
      break
    case 'techFoul': {
      const tSide = targetSide ?? oppSide
      const targetPlayer = tSide === side ? me : opp
      if (!targetSlot || !targetPlayer.lineup[targetSlot]) return state
      const damaged = applyDamageToSlot(targetPlayer, targetSlot, 4)
      if (tSide === side) me = damaged.player
      else opp = damaged.player
      logLine += damaged.fouledOut ? ` It fouls out the target!` : ''
      break
    }
  }

  players = { ...players, [side]: me, [oppSide]: opp }
  return { ...state, players, log: [logLine, ...state.log] }
}

function buffLineup(p: PlayerState, fn: (a: BoardAthlete) => BoardAthlete): PlayerState {
  const lineup: Lineup = { ...p.lineup }
  for (const pos of POSITIONS) {
    const a = lineup[pos]
    if (a) lineup[pos] = fn(a)
  }
  return { ...p, lineup }
}

/** Apply raw damage to one athlete, honouring Iron, removing on foul-out. */
function applyDamageToSlot(
  p: PlayerState,
  slot: Position,
  damage: number,
): { player: PlayerState; fouledOut: boolean } {
  const a = p.lineup[slot]
  if (!a) return { player: p, fouledOut: false }
  let sta = a.sta - damage
  let ironUsed = a.ironUsed
  if (sta <= 0 && a.card.ability === 'iron' && !ironUsed) {
    sta = 1
    ironUsed = true
  }
  if (sta <= 0) {
    return { player: { ...p, lineup: { ...p.lineup, [slot]: null } }, fouledOut: true }
  }
  return { player: { ...p, lineup: { ...p.lineup, [slot]: { ...a, sta, ironUsed } } }, fouledOut: false }
}

// ---------------------------------------------------------------------------
// Clash resolution (simultaneous)
// ---------------------------------------------------------------------------

/**
 * Resolve all five lanes simultaneously: snapshot effective stats first, then
 * apply scoring and stamina damage, then remove fouled-out athletes and clear
 * one-shot clash buffs. Returns a new state (does not advance the clock/turn).
 */
export function resolveClash(state: GameState): GameState {
  const player = state.players.player
  const ai = state.players.ai
  const lateGame = state.quarter >= QUARTERS

  // 1. Snapshot effective stats from the pre-clash board.
  type Snap = { off: number; def: number }
  const pSnap: Partial<Record<Position, Snap>> = {}
  const aSnap: Partial<Record<Position, Snap>> = {}
  for (const pos of POSITIONS) {
    const pA = player.lineup[pos]
    const aA = ai.lineup[pos]
    if (pA) pSnap[pos] = { off: effectiveOff(pA, player, aA === null, lateGame), def: effectiveDef(pA) }
    if (aA) aSnap[pos] = { off: effectiveOff(aA, ai, pA === null, lateGame), def: effectiveDef(aA) }
  }

  // 2. Compute buckets and damage per lane from the snapshot. Beating the
  //    defender is a 2; a blowout margin is a 3; a contested lane scores 0.
  const bucket = (margin: number): number => {
    if (margin <= 0) return 0
    return margin >= THREE_POINT_MARGIN ? 3 : 2
  }
  let pScore = 0
  let aScore = 0
  const pDamage: Partial<Record<Position, number>> = {}
  const aDamage: Partial<Record<Position, number>> = {}
  const lines: string[] = []

  for (const pos of POSITIONS) {
    const p = pSnap[pos]
    const a = aSnap[pos]
    if (p) {
      const pts = bucket(p.off - (a ? a.def : 0))
      pScore += pts
      if (a) aDamage[pos] = (aDamage[pos] ?? 0) + p.off
      if (pts > 0) lines.push(`You score ${pts} at ${pos}.`)
    }
    if (a) {
      const pts = bucket(a.off - (p ? p.def : 0))
      aScore += pts
      if (p) pDamage[pos] = (pDamage[pos] ?? 0) + a.off
      if (pts > 0) lines.push(`CPU scores ${pts} at ${pos}.`)
    }
  }

  // 3. Apply damage + foul-outs, then clear clash buffs for survivors.
  const settle = (p: PlayerState, dmg: Partial<Record<Position, number>>): PlayerState => {
    let out = p
    for (const pos of POSITIONS) {
      const d = dmg[pos]
      if (d && out.lineup[pos]) {
        const res = applyDamageToSlot(out, pos, d)
        out = res.player
        if (res.fouledOut) lines.push(`${labelFor(p.side)}'s ${pos} fouls out.`)
      }
    }
    // clear one-shot buffs
    return buffLineup(out, (ath) => ({ ...ath, clashOff: 0, clashDef: 0 }))
  }

  const newPlayer = { ...settle(player, pDamage), score: player.score + pScore }
  const newAi = { ...settle(ai, aDamage), score: ai.score + aScore }

  const summary = `Clash: You +${pScore}, CPU +${aScore}.`
  return {
    ...state,
    players: { player: newPlayer, ai: newAi },
    log: [summary, ...lines.reverse(), ...state.log],
  }
}

// ---------------------------------------------------------------------------
// Clock / turn progression
// ---------------------------------------------------------------------------

/** Tick per-turn passive abilities and bump survival counters. */
function tickAbilities(p: PlayerState): PlayerState {
  return buffLineup(p, (a) => {
    let sta = a.sta
    if (a.card.ability === 'rebound') sta = Math.min(a.card.sta, sta + 1)
    return { ...a, sta, turnsSurvived: a.turnsSurvived + 1 }
  })
}

/** Start a new possession: refill energy (+ playmaker bonus), draw, tick. */
function advanceTurn(state: GameState): GameState {
  const turn = state.turn + 1
  const base = energyForTurn(turn)
  const refill = (p: PlayerState): PlayerState => {
    const ticked = tickAbilities(p)
    const bonus = countAbility(ticked.lineup, 'playmaker')
    return draw({ ...ticked, energy: Math.min(MAX_ENERGY, base + bonus) }, DRAW_PER_TURN)
  }
  return {
    ...state,
    turn,
    phase: 'deploy',
    players: {
      player: refill(state.players.player),
      ai: refill(state.players.ai),
    },
  }
}

export function checkWinner(state: GameState): Side | 'tie' | undefined {
  if (state.quarter < QUARTERS) return undefined
  // Only decided once regulation (and any OT) clock has expired.
  if (state.gameClock > 0) return undefined
  const p = state.players.player.score
  const a = state.players.ai.score
  if (p === a) return undefined // tie → overtime, handled by caller
  return p > a ? 'player' : 'ai'
}

/**
 * Burn game-clock time for the resolved possession and handle quarter / OT /
 * game-over transitions. Advances the RNG for the possession-length roll.
 */
function burnGameClock(state: GameState): GameState {
  let [seconds, rng] = nextInt(
    state.rngState,
    POSSESSION_GAME_SECONDS_MIN,
    POSSESSION_GAME_SECONDS_MAX,
  )
  const gameClock = state.gameClock - seconds
  let next: GameState = { ...state, rngState: rng, gameClock }

  if (gameClock > 0) {
    return advanceTurn(next)
  }

  // Quarter (or OT period) just ended.
  next = { ...next, gameClock: 0 }
  const p = next.players.player.score
  const a = next.players.ai.score

  if (next.quarter < QUARTERS) {
    return { ...next, phase: 'quarterBreak', log: [`End of Q${next.quarter}.`, ...next.log] }
  }

  // End of regulation / overtime.
  if (p === a) {
    return { ...next, phase: 'quarterBreak', log: [`Tied ${p}-${a}! Headed to overtime.`, ...next.log] }
  }
  const winner: Side = p > a ? 'player' : 'ai'
  return {
    ...next,
    phase: 'gameover',
    winner,
    log: [`Final: You ${p} - ${a} CPU. ${winner === 'player' ? 'You win!' : 'CPU wins.'}`, ...next.log],
  }
}

/** Leave the quarter break: reset the quarter clock and advance the period. */
function startNextQuarter(state: GameState): GameState {
  const isOvertime = state.quarter >= QUARTERS
  const quarter = state.quarter + 1
  const label = isOvertime ? `Overtime!` : `Q${quarter} tip-off.`
  const seeded: GameState = {
    ...state,
    quarter,
    gameClock: QUARTER_GAME_SECONDS,
    log: [label, ...state.log],
  }
  return advanceTurn(seeded)
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function labelFor(side: Side): string {
  return side === 'player' ? 'You' : 'CPU'
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'NEW_GAME':
      return createInitialState(action.seed)

    case 'PLAY_ATHLETE':
      if (state.phase !== 'deploy') return state
      return playAthlete(state, 'player', action.cardId, action.slot)

    case 'PLAY_POWERUP':
      if (state.phase !== 'deploy') return state
      return playPowerUp(state, 'player', action.cardId, action.targetSide, action.targetSlot)

    case 'END_POSSESSION': {
      if (state.phase !== 'deploy') return state
      // Lazily import AI to avoid a circular module reference at load time.
      const withAi = applyAiTurn(state)
      const resolved = resolveClash(withAi)
      return burnGameClock(resolved)
    }

    case 'ADVANCE_QUARTER':
      if (state.phase !== 'quarterBreak') return state
      return startNextQuarter(state)

    default:
      return state
  }
}

// AI is wired in here to keep the reducer the single entry point. The function
// is provided by ai.ts via setAiStrategy to avoid an import cycle.
let aiStrategy: ((state: GameState) => GameState) | null = null
export function setAiStrategy(fn: (state: GameState) => GameState): void {
  aiStrategy = fn
}
function applyAiTurn(state: GameState): GameState {
  return aiStrategy ? aiStrategy(state) : state
}
