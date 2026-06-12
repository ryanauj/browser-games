import {
  CLASH_DAMAGE_MAX,
  CLASH_DAMAGE_MIN,
  DECK_SIZE,
  DRAW_PER_TURN,
  ENERGY_PER_TURN,
  FIT_BONUS,
  HAND_CAP,
  MAX_ENERGY,
  MISMATCH_PENALTY,
  OPENING_HAND,
  OPENING_HAND_MIN_ATHLETES,
  POSITIONS,
  POSSESSION_GAME_SECONDS_MAX,
  POSSESSION_GAME_SECONDS_MIN,
  QUARTER_GAME_SECONDS,
  QUARTERS,
  HUSTLE_CAP,
  RALLY_DEFICIT,
  STARTING_ENERGY,
  TECH_FOUL_DAMAGE,
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
  // High-cost stars are single-copy "legendaries" so abilities like Takeover
  // can't stack into a runaway board.
  ATHLETES.forEach((a) => stamp(a, a.cost >= 5 ? 1 : 2))
  POWER_UPS.forEach((p) => stamp(p, 2))

  const [shuffled, next] = shuffle(copies, state)
  return [ensureOpeningAthletes(shuffled.slice(0, DECK_SIZE)), next]
}

/**
 * Guarantee the opening hand is playable: swap power-ups out of the opening
 * segment for athletes deeper in the deck until the minimum is met.
 */
function ensureOpeningAthletes(deck: Card[]): Card[] {
  const out = deck.slice()
  let athletes = out.slice(0, OPENING_HAND).filter((c) => c.kind === 'athlete').length
  for (let i = 0; i < OPENING_HAND && athletes < OPENING_HAND_MIN_ATHLETES; i++) {
    if (out[i].kind === 'athlete') continue
    for (let j = out.length - 1; j >= OPENING_HAND; j--) {
      if (out[j].kind === 'athlete') {
        ;[out[i], out[j]] = [out[j], out[i]]
        athletes++
        break
      }
    }
  }
  return out
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

  const state: GameState = {
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
  // The CPU commits its plays at the START of every possession so the player
  // can see the opposing lineup (and the lane projections) while planning.
  return applyAiTurn(state)
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
  if (ath.card.ability === 'hustle') off += Math.min(HUSTLE_CAP, ath.turnsSurvived)
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
      const damaged = applyDamageToSlot(targetPlayer, targetSlot, TECH_FOUL_DAMAGE)
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

/**
 * Apply raw damage to one athlete, honouring Iron. On foul-out the athlete
 * leaves the court and its card cycles to the bottom of the owner's deck
 * (Clash Royale-style rotation), so a wiped board can always rebuild.
 */
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
    return {
      player: { ...p, lineup: { ...p.lineup, [slot]: null }, deck: [...p.deck, a.card] },
      fouledOut: true,
    }
  }
  return { player: { ...p, lineup: { ...p.lineup, [slot]: { ...a, sta, ironUsed } } }, fouledOut: false }
}

// ---------------------------------------------------------------------------
// Clash math (shared by resolution and the live lane preview)
// ---------------------------------------------------------------------------

/** Projected outcome of one lane if the possession ended right now. */
export interface LaneOutcome {
  pos: Position
  /** Points each side would score in this lane. */
  playerPts: number
  aiPts: number
  /** Stamina damage each side's athlete would take (0 if lane half empty). */
  playerDmg: number
  aiDmg: number
  playerHas: boolean
  aiHas: boolean
}

const bucket = (margin: number): number => {
  if (margin <= 0) return 0
  return margin >= THREE_POINT_MARGIN ? 3 : 2
}

/**
 * Compute every lane's outcome from the current boards. Because the CPU has
 * already committed its plays for the possession, this is an exact preview of
 * what resolveClash will do — the UI surfaces it as per-lane chips.
 */
export function computeClash(state: GameState): LaneOutcome[] {
  const player = state.players.player
  const ai = state.players.ai
  const lateGame = state.quarter >= QUARTERS

  return POSITIONS.map((pos) => {
    const pA = player.lineup[pos]
    const aA = ai.lineup[pos]
    const p = pA
      ? { off: effectiveOff(pA, player, aA === null, lateGame), def: effectiveDef(pA) }
      : null
    const a = aA
      ? { off: effectiveOff(aA, ai, pA === null, lateGame), def: effectiveDef(aA) }
      : null

    // Beating the defender scores 2, or 3 on a wide margin. An empty opposing
    // lane concedes an easy 2 (uncontested layup — never a 3, which keeps
    // board wipes from snowballing). Stamina damage is the attack margin
    // (OFF − DEF) clamped to [1, 3] in contested lanes: walls are mortal, but
    // a fresh athlete always survives its first clash.
    const clamp = (n: number) => Math.min(CLASH_DAMAGE_MAX, Math.max(CLASH_DAMAGE_MIN, n))
    const playerPts = p ? (a ? bucket(p.off - a.def) : p.off > 0 ? 2 : 0) : 0
    const aiPts = a ? (p ? bucket(a.off - p.def) : a.off > 0 ? 2 : 0) : 0
    const playerDmg = p && a ? clamp(a.off - p.def) : 0
    const aiDmg = p && a ? clamp(p.off - a.def) : 0

    return { pos, playerPts, aiPts, playerDmg, aiDmg, playerHas: !!pA, aiHas: !!aA }
  })
}

/**
 * Resolve all five lanes simultaneously: snapshot outcomes from the pre-clash
 * board, then apply scoring and stamina damage, remove fouled-out athletes,
 * and clear one-shot clash buffs. Returns a new state (does not advance the
 * clock/turn).
 */
export function resolveClash(state: GameState): GameState {
  const lanes = computeClash(state)

  let pScore = 0
  let aScore = 0
  const lines: string[] = []
  for (const lane of lanes) {
    pScore += lane.playerPts
    aScore += lane.aiPts
    if (lane.playerPts > 0) lines.push(`You score ${lane.playerPts} at ${lane.pos}.`)
    if (lane.aiPts > 0) lines.push(`CPU scores ${lane.aiPts} at ${lane.pos}.`)
  }

  const settle = (p: PlayerState, dmgOf: (lane: LaneOutcome) => number): PlayerState => {
    let out = p
    for (const lane of lanes) {
      const d = dmgOf(lane)
      if (d > 0 && out.lineup[lane.pos]) {
        const res = applyDamageToSlot(out, lane.pos, d)
        out = res.player
        if (res.fouledOut) lines.push(`${labelFor(p.side)}'s ${lane.pos} fouls out — back to the deck.`)
      }
    }
    // clear one-shot buffs
    return buffLineup(out, (ath) => ({ ...ath, clashOff: 0, clashDef: 0 }))
  }

  const newPlayer = {
    ...settle(state.players.player, (l) => l.playerDmg),
    score: state.players.player.score + pScore,
  }
  const newAi = {
    ...settle(state.players.ai, (l) => l.aiDmg),
    score: state.players.ai.score + aScore,
  }

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
  const refill = (p: PlayerState, opp: PlayerState): PlayerState => {
    const ticked = tickAbilities(p)
    const bonus = countAbility(ticked.lineup, 'playmaker')
    // Rally: a side trailing big draws an extra card, so games stay games.
    const rally = p.score + RALLY_DEFICIT <= opp.score ? 1 : 0
    return draw({ ...ticked, energy: Math.min(MAX_ENERGY, base + bonus) }, DRAW_PER_TURN + rally)
  }
  const next: GameState = {
    ...state,
    turn,
    phase: 'deploy',
    players: {
      player: refill(state.players.player, state.players.ai),
      ai: refill(state.players.ai, state.players.player),
    },
  }
  // CPU plays first each possession, in the open — see createInitialState.
  return applyAiTurn(next)
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
      // The CPU already committed its plays at possession start, so the clash
      // resolves exactly as the lane preview showed.
      const resolved = resolveClash(state)
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
