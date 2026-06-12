import {
  BASE_FATIGUE,
  BENCH_RECOVERY,
  CLASH_DAMAGE_MAX,
  CLASH_DAMAGE_MIN,
  DRAW_PER_TURN,
  ENERGY_PER_POSSESSION,
  FIT_BONUS,
  FOUL_LIMIT,
  GASSED_PENALTY,
  HAND_CAP,
  HUSTLE_CAP,
  MAX_OVERTIMES,
  MISMATCH_PENALTY,
  OPENING_HAND,
  POSITIONS,
  POSSESSION_GAME_SECONDS_MAX,
  POSSESSION_GAME_SECONDS_MIN,
  QUARTER_GAME_SECONDS,
  QUARTERS,
  RALLY_DEFICIT,
  ROSTER_PER_POSITION,
  SUB_COST,
  THREE_POINT_MARGIN,
  TIRED_THRESHOLD,
} from './constants'
import { ATHLETES, PLAYS } from './cards'
import { nextInt, shuffle } from './rng'
import type {
  Action,
  GameState,
  Lineup,
  PlayCard,
  PlayerState,
  Position,
  RosterAthlete,
  Side,
} from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let uidCounter = 0
function nextUid(): string {
  return `r${uidCounter++}`
}

function freshAthlete(card: (typeof ATHLETES)[number], side: Side): RosterAthlete {
  return {
    uid: `${side}-${nextUid()}`,
    card,
    sta: card.sta,
    fouls: 0,
    heat: 0,
    clashOff: 0,
    clashDef: 0,
    ironUsed: false,
  }
}

/**
 * Deal the game's rosters: ROSTER_PER_POSITION athletes per position drawn
 * from that position's archetypes. Both sides get the SAME deal — a fair
 * scrimmage where games diverge through rotation decisions, not roster luck.
 * Within each position the statistically stronger athlete starts.
 */
function buildRosters(
  state: number,
): [Lineup, RosterAthlete[], Lineup, RosterAthlete[], number] {
  const mk = (): [Lineup, RosterAthlete[]] => [
    { PG: null, SG: null, SF: null, PF: null, C: null },
    [],
  ]
  const [pLineup, pBench] = mk()
  const [aLineup, aBench] = mk()
  let s = state
  for (const pos of POSITIONS) {
    const pool = ATHLETES.filter((a) => a.position === pos)
    let picks: typeof pool
    ;[picks, s] = shuffle(pool, s)
    const dealt = picks.slice(0, ROSTER_PER_POSITION).slice()
    dealt.sort((a, b) => b.off + b.def - (a.off + a.def))
    pLineup[pos] = freshAthlete(dealt[0], 'player')
    aLineup[pos] = freshAthlete(dealt[0], 'ai')
    for (const card of dealt.slice(1)) {
      pBench.push(freshAthlete(card, 'player'))
      aBench.push(freshAthlete(card, 'ai'))
    }
  }
  return [pLineup, pBench, aLineup, aBench, s]
}

/** The coach's playbook: two copies of each play, shuffled. */
function buildPlaybook(side: Side, state: number): [PlayCard[], number] {
  const copies: PlayCard[] = []
  let counter = 0
  for (const p of PLAYS) {
    for (let i = 0; i < 2; i++) {
      copies.push({ ...p, id: `${side}-${p.id}#${counter++}` })
    }
  }
  return shuffle(copies, state)
}

/** Draw up to `n` play cards, respecting the hand cap. */
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

export function createInitialState(seed: number = Date.now()): GameState {
  let s = seed | 0
  let pLineup: Lineup, pBench: RosterAthlete[]
  let aLineup: Lineup, aBench: RosterAthlete[]
  let pDeck: PlayCard[], aDeck: PlayCard[]
  ;[pLineup, pBench, aLineup, aBench, s] = buildRosters(s)
  ;[pDeck, s] = buildPlaybook('player', s)
  ;[aDeck, s] = buildPlaybook('ai', s)

  const mkPlayer = (side: Side, lineup: Lineup, bench: RosterAthlete[], deck: PlayCard[]): PlayerState =>
    draw(
      {
        side,
        deck,
        hand: [],
        lineup,
        bench,
        energy: ENERGY_PER_POSSESSION + countAbility(lineup, 'playmaker'),
        score: 0,
      },
      OPENING_HAND,
    )

  const state: GameState = {
    turn: 1,
    quarter: 1,
    phase: 'deploy',
    gameClock: QUARTER_GAME_SECONDS,
    players: {
      player: mkPlayer('player', pLineup, pBench, pDeck),
      ai: mkPlayer('ai', aLineup, aBench, aDeck),
    },
    seed,
    rngState: s,
    log: ['Tip-off! Q1 is underway. Starters are on the floor.'],
    winner: undefined,
  }
  // The CPU coach commits its subs/plays at the START of every possession so
  // the player can see the opposing five (and the lane projections) while
  // planning.
  return applyAiTurn(state)
}

// ---------------------------------------------------------------------------
// Stat math
// ---------------------------------------------------------------------------

/** Positional fit modifiers: on-position rewards, off-position penalises. */
export function fitMods(ath: RosterAthlete, slot: Position): { off: number; def: number } {
  const onPosition = ath.card.position === slot
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

export function isGassed(ath: RosterAthlete): boolean {
  return ath.sta <= 0
}

/** Effective offense for an athlete during a clash. */
export function effectiveOff(
  ath: RosterAthlete,
  slot: Position,
  owner: PlayerState,
  defender: RosterAthlete | null,
  lateGame: boolean,
): number {
  let off = ath.card.off + fitMods(ath, slot).off + ath.clashOff
  if (ath.card.ability === 'hustle') off += Math.min(HUSTLE_CAP, ath.heat)
  if (ath.card.ability === 'fastBreak' && (!defender || defender.sta <= TIRED_THRESHOLD)) off += 2
  if (ath.card.ability === 'clutch' && lateGame) off += 2
  // Takeover boosts other allies, so count takeover athletes other than self.
  const takeovers = countAbility(owner.lineup, 'takeover')
  const selfTakeover = ath.card.ability === 'takeover' ? 1 : 0
  off += takeovers - selfTakeover
  if (isGassed(ath)) off -= GASSED_PENALTY
  return Math.max(0, off)
}

/** Effective defense for an athlete during a clash. */
export function effectiveDef(ath: RosterAthlete, slot: Position): number {
  let def = ath.card.def + fitMods(ath, slot).def + ath.clashDef
  if (isGassed(ath)) def -= GASSED_PENALTY
  return Math.max(0, def)
}

// ---------------------------------------------------------------------------
// Coaching moves (used by both the player UI and the CPU coach)
// ---------------------------------------------------------------------------

/** Reduce stamina, honouring the Iron save. Stamina floors at 0 (gassed). */
function drainSta(a: RosterAthlete, amount: number): RosterAthlete {
  if (amount <= 0) return a
  let sta = a.sta - amount
  let ironUsed = a.ironUsed
  if (sta <= 0 && a.card.ability === 'iron' && !ironUsed) {
    sta = 1
    ironUsed = true
  }
  return { ...a, sta: Math.max(0, sta), ironUsed }
}

/**
 * Substitute a bench athlete into a slot (costs SUB_COST energy). The athlete
 * coming off keeps stamina/fouls but loses heat and clash buffs; an empty
 * slot (after a foul-out) is simply filled. Returns unchanged state if illegal.
 */
export function subAthlete(
  state: GameState,
  side: Side,
  benchUid: string,
  slot: Position,
): GameState {
  const player = state.players[side]
  const incoming = player.bench.find((a) => a.uid === benchUid)
  if (!incoming) return state
  if (player.energy < SUB_COST) return state

  const outgoing = player.lineup[slot]
  const bench = player.bench.filter((a) => a.uid !== benchUid)
  if (outgoing) {
    bench.push({ ...outgoing, heat: 0, clashOff: 0, clashDef: 0 })
  }
  const updated: PlayerState = {
    ...player,
    energy: player.energy - SUB_COST,
    lineup: { ...player.lineup, [slot]: { ...incoming, heat: 0, clashOff: 0, clashDef: 0 } },
    bench,
  }
  const line = outgoing
    ? `${labelFor(side)} subs ${incoming.card.name} in for ${outgoing.card.name} at ${slot}.`
    : `${labelFor(side)} sends ${incoming.card.name} in at ${slot}.`
  return {
    ...state,
    players: { ...state.players, [side]: updated },
    log: [line, ...state.log],
  }
}

/** Add a foul; at the limit the athlete fouls out of the game entirely. */
function addFoul(
  p: PlayerState,
  slot: Position,
): { player: PlayerState; fouledOut: RosterAthlete | null } {
  const a = p.lineup[slot]
  if (!a) return { player: p, fouledOut: null }
  const fouls = a.fouls + 1
  if (fouls >= FOUL_LIMIT) {
    return { player: { ...p, lineup: { ...p.lineup, [slot]: null } }, fouledOut: a }
  }
  return { player: { ...p, lineup: { ...p.lineup, [slot]: { ...a, fouls } } }, fouledOut: null }
}

/** Play a card from the playbook. Some need a target slot/side. */
export function playCard(
  state: GameState,
  side: Side,
  cardId: string,
  targetSide?: Side,
  targetSlot?: Position,
): GameState {
  const player = state.players[side]
  const card = player.hand.find((c) => c.id === cardId)
  if (!card) return state
  if (card.cost > player.energy) return state

  const oppSide: Side = side === 'player' ? 'ai' : 'player'
  let me: PlayerState = {
    ...player,
    energy: player.energy - card.cost,
    hand: player.hand.filter((c) => c.id !== cardId),
  }
  let opp: PlayerState = { ...state.players[oppSide] }
  let logLine = `${labelFor(side)} calls ${card.name}.`

  const mutate = (
    p: PlayerState,
    slot: Position,
    fn: (a: RosterAthlete) => RosterAthlete,
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
        me = mutate(me, targetSlot, (a) => ({ ...a, clashOff: a.clashOff + 3 }))
        logLine += ` ${me.lineup[targetSlot]!.card.name} gets +3 OFF.`
      } else return state
      break
    }
    case 'timeout': {
      if (targetSlot && me.lineup[targetSlot]) {
        me = mutate(me, targetSlot, (a) => ({ ...a, sta: Math.min(a.card.sta, a.sta + 3) }))
        logLine += ` ${me.lineup[targetSlot]!.card.name} catches a breather (+3 STA).`
      } else return state
      break
    }
    case 'zoneDefense':
      me = mapLineup(me, (a) => ({ ...a, clashDef: a.clashDef + 2 }))
      break
    case 'fullCourtPress':
      opp = mapLineup(opp, (a) => ({ ...a, clashOff: a.clashOff - 2 }))
      break
    case 'flop': {
      if (!targetSlot || !opp.lineup[targetSlot]) return state
      const name = opp.lineup[targetSlot]!.card.name
      const res = addFoul(opp, targetSlot)
      opp = res.player
      logLine += res.fouledOut
        ? ` ${name} picks up a foul — that's ${FOUL_LIMIT}, and he's out of the game!`
        : ` ${name} picks up a foul.`
      break
    }
  }
  // targetSide is implied by the effect's target kind; kept in the action for
  // future plays that could target either side.
  void targetSide

  return {
    ...state,
    players: { ...state.players, [side]: me, [oppSide]: opp },
    log: [logLine, ...state.log],
  }
}

function mapLineup(p: PlayerState, fn: (a: RosterAthlete) => RosterAthlete): PlayerState {
  const lineup: Lineup = { ...p.lineup }
  for (const pos of POSITIONS) {
    const a = lineup[pos]
    if (a) lineup[pos] = fn(a)
  }
  return { ...p, lineup }
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
  /** Extra stamina drain each side's athlete takes from being attacked. */
  playerDrain: number
  aiDrain: number
  /** Whether each side's defender would pick up a foul (blown out by 4+). */
  playerFoul: boolean
  aiFoul: boolean
  playerHas: boolean
  aiHas: boolean
}

const bucket = (margin: number): number => {
  if (margin <= 0) return 0
  return margin >= THREE_POINT_MARGIN ? 3 : 2
}

/**
 * Compute every lane's outcome from the current boards. Because the CPU coach
 * has already committed its moves for the possession, this is an exact
 * preview of what resolveClash will do — the UI surfaces it as lane chips.
 */
export function computeClash(state: GameState): LaneOutcome[] {
  const player = state.players.player
  const ai = state.players.ai
  const lateGame = state.quarter >= QUARTERS

  return POSITIONS.map((pos) => {
    const pA = player.lineup[pos]
    const aA = ai.lineup[pos]
    const p = pA
      ? { off: effectiveOff(pA, pos, player, aA, lateGame), def: effectiveDef(pA, pos) }
      : null
    const a = aA
      ? { off: effectiveOff(aA, pos, ai, pA, lateGame), def: effectiveDef(aA, pos) }
      : null

    // Beating the defender scores 2, or 3 on a blowout (+4 margin). An empty
    // opposing lane (foul-outs with no sub) concedes an easy 2. Being beaten
    // drains extra stamina (margin clamped to 1..3); being blown out also
    // costs the defender a foul.
    const clamp = (n: number) => Math.min(CLASH_DAMAGE_MAX, Math.max(CLASH_DAMAGE_MIN, n))
    const pMargin = p && a ? p.off - a.def : 0
    const aMargin = p && a ? a.off - p.def : 0
    const playerPts = p ? (a ? bucket(pMargin) : p.off > 0 ? 2 : 0) : 0
    const aiPts = a ? (p ? bucket(aMargin) : a.off > 0 ? 2 : 0) : 0
    const playerDrain = p && a && aMargin > 0 ? clamp(aMargin) : 0
    const aiDrain = p && a && pMargin > 0 ? clamp(pMargin) : 0
    const playerFoul = !!(p && a) && aMargin >= THREE_POINT_MARGIN
    const aiFoul = !!(p && a) && pMargin >= THREE_POINT_MARGIN

    return {
      pos,
      playerPts,
      aiPts,
      playerDrain,
      aiDrain,
      playerFoul,
      aiFoul,
      playerHas: !!pA,
      aiHas: !!aA,
    }
  })
}

/**
 * Resolve all five lanes simultaneously: snapshot outcomes from the pre-clash
 * board, then apply scoring, stamina drain and fouls, and clear one-shot
 * clash buffs. Returns a new state (does not advance the clock/turn).
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

  const settle = (
    p: PlayerState,
    drainOf: (lane: LaneOutcome) => number,
    foulOf: (lane: LaneOutcome) => boolean,
  ): PlayerState => {
    let out = p
    for (const lane of lanes) {
      const a = out.lineup[lane.pos]
      if (!a) continue
      const drained = drainSta(a, drainOf(lane))
      out = { ...out, lineup: { ...out.lineup, [lane.pos]: drained } }
      if (drained.sta <= 0 && a.sta > 0) {
        lines.push(`${labelFor(p.side)}'s ${drained.card.name} is gassed!`)
      }
      if (foulOf(lane)) {
        const res = addFoul(out, lane.pos)
        out = res.player
        if (res.fouledOut) {
          lines.push(
            `${labelFor(p.side)}'s ${res.fouledOut.card.name} fouls out of the game (${FOUL_LIMIT} fouls)!`,
          )
        } else {
          lines.push(`Foul on ${labelFor(p.side)}'s ${lane.pos} defender.`)
        }
      }
    }
    // clear one-shot buffs
    return mapLineup(out, (ath) => ({ ...ath, clashOff: 0, clashDef: 0 }))
  }

  const newPlayer = {
    ...settle(state.players.player, (l) => l.playerDrain, (l) => l.playerFoul),
    score: state.players.player.score + pScore,
  }
  const newAi = {
    ...settle(state.players.ai, (l) => l.aiDrain, (l) => l.aiFoul),
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

/**
 * Per-possession conditioning: everyone on court pays base fatigue (Rebound
 * recovers it) and gains heat; the bench recovers stamina.
 */
function tickCondition(p: PlayerState): PlayerState {
  const onCourt = mapLineup(p, (a) => {
    const rebound = a.card.ability === 'rebound' ? 1 : 0
    const net = BASE_FATIGUE - rebound
    const drained = net > 0 ? drainSta(a, net) : { ...a, sta: Math.min(a.card.sta, a.sta - net) }
    return { ...drained, heat: drained.heat + 1 }
  })
  return {
    ...onCourt,
    bench: onCourt.bench.map((a) => ({ ...a, sta: Math.min(a.card.sta, a.sta + BENCH_RECOVERY) })),
  }
}

/** Start a new possession: condition tick, refill coach energy, draw plays. */
function advanceTurn(state: GameState): GameState {
  const turn = state.turn + 1
  const refill = (p: PlayerState, opp: PlayerState): PlayerState => {
    const ticked = tickCondition(p)
    const bonus = countAbility(ticked.lineup, 'playmaker')
    // Rally: a side trailing big gets +1 energy (more subs) and an extra play
    // card, so games stay games.
    const rally = p.score + RALLY_DEFICIT <= opp.score ? 1 : 0
    return draw(
      { ...ticked, energy: ENERGY_PER_POSSESSION + bonus + rally },
      DRAW_PER_TURN + rally,
    )
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
  // CPU coach moves first each possession, in the open — see createInitialState.
  return applyAiTurn(next)
}

/**
 * Burn game-clock time for the resolved possession and handle quarter / OT /
 * game-over transitions. Advances the RNG for the possession-length roll.
 */
function burnGameClock(state: GameState): GameState {
  const p = state.players.player.score
  const a = state.players.ai.score

  // Overtime is sudden death: the first clash that breaks the tie ends it.
  if (state.quarter > QUARTERS && p !== a) {
    return finishGame(state, p > a ? 'player' : 'ai', 'Sudden death!')
  }

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

  if (next.quarter < QUARTERS) {
    return { ...next, phase: 'quarterBreak', log: [`End of Q${next.quarter}.`, ...next.log] }
  }

  if (p !== a) {
    return finishGame(next, p > a ? 'player' : 'ai')
  }

  // Still tied. More overtime — until the cap, where the fresher team wins.
  if (next.quarter < QUARTERS + MAX_OVERTIMES) {
    return { ...next, phase: 'quarterBreak', log: [`Tied ${p}-${a}! Headed to overtime.`, ...next.log] }
  }
  const winner = conditioningTiebreak(next)
  return finishGame(next, winner, 'Still tied — the fresher team takes it on conditioning!')
}

/** Deepest-tiebreak: more total stamina left, then fewer fouls, then home court. */
function conditioningTiebreak(state: GameState): Side {
  const tally = (p: PlayerState) => {
    let sta = 0
    let fouls = 0
    for (const pos of POSITIONS) {
      const a = p.lineup[pos]
      if (a) {
        sta += a.sta
        fouls += a.fouls
      }
    }
    for (const a of p.bench) {
      sta += a.sta
      fouls += a.fouls
    }
    return { sta, fouls }
  }
  const mine = tally(state.players.player)
  const theirs = tally(state.players.ai)
  if (mine.sta !== theirs.sta) return mine.sta > theirs.sta ? 'player' : 'ai'
  if (mine.fouls !== theirs.fouls) return mine.fouls < theirs.fouls ? 'player' : 'ai'
  return 'player' // home court
}

function finishGame(state: GameState, winner: Side, note?: string): GameState {
  const p = state.players.player.score
  const a = state.players.ai.score
  const headline = `Final: You ${p} - ${a} CPU. ${winner === 'player' ? 'You win!' : 'CPU wins.'}`
  return {
    ...state,
    phase: 'gameover',
    winner,
    log: [note ? `${note} ${headline}` : headline, ...state.log],
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

    case 'SUB':
      if (state.phase !== 'deploy') return state
      return subAthlete(state, 'player', action.benchUid, action.slot)

    case 'PLAY_CARD':
      if (state.phase !== 'deploy') return state
      return playCard(state, 'player', action.cardId, action.targetSide, action.targetSlot)

    case 'END_POSSESSION': {
      if (state.phase !== 'deploy') return state
      // The CPU coach already committed its moves at possession start, so the
      // clash resolves exactly as the lane preview showed.
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
