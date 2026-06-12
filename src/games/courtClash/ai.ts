import { FOUL_LIMIT, POSITIONS, SUB_COST, TIRED_THRESHOLD } from './constants'
import { computeClash, playCard, setAiStrategy, subAthlete } from './engine'
import type { GameState, PlayCard, Position, RosterAthlete } from './types'

/**
 * The CPU coach. Pure: takes a state and returns a new state with the AI's
 * moves applied for this possession. Rotation is the hard priority — energy
 * goes to substitutions first, and at most ONE play is called with whatever
 * is left (keeping the CPU beatable and its behaviour legible):
 *   1. Fill any empty slot (foul-out hole) with the best bench athlete.
 *   2. Rest the most-tired athletes and pull anyone one foul from
 *      disqualification out of a lane that projects a foul.
 *   3. One play: Flop > Timeout > Full Court Press > Clutch Gene > Zone.
 */

const AI: 'ai' = 'ai'

function energy(state: GameState): number {
  return state.players.ai.energy
}

/** Heuristic value of a bench athlete filling a given slot. */
function benchValue(a: RosterAthlete, slot: Position): number {
  const fit = a.card.position === slot ? 3 : -3
  return a.card.off + a.card.def + a.sta * 0.5 + fit
}

/** Best bench athlete for a slot who is meaningfully fresher than `minSta`. */
function bestBenchFor(state: GameState, slot: Position, minSta: number): RosterAthlete | null {
  let best: RosterAthlete | null = null
  for (const a of state.players.ai.bench) {
    if (a.sta <= minSta + 1) continue
    if (!best || benchValue(a, slot) > benchValue(best, slot)) best = a
  }
  return best
}

function playInHand(state: GameState, effect: PlayCard['effect']): PlayCard | undefined {
  return state.players.ai.hand.find((c) => c.effect === effect && c.cost <= energy(state))
}

export function chooseAiTurn(initial: GameState): GameState {
  let state = initial

  // 1. Fill empty slots first — an empty lane concedes points every clash.
  for (const pos of POSITIONS) {
    if (energy(state) < SUB_COST) break
    if (state.players.ai.lineup[pos]) continue
    const sub = bestBenchFor(state, pos, -1)
    if (sub) state = subAthlete(state, AI, sub.uid, pos)
  }

  // 2. Rotate, most-tired first. Subbing trumps saving energy for plays —
  //    gassed athletes bleed points and fouls every clash they stay out.
  const tired = POSITIONS.map((pos) => ({ pos, a: state.players.ai.lineup[pos] }))
    .filter((x): x is { pos: Position; a: RosterAthlete } => !!x.a && x.a.sta <= TIRED_THRESHOLD)
    .sort((x, y) => x.a.sta - y.a.sta)
  for (const { pos, a } of tired) {
    if (energy(state) < SUB_COST) break
    const sub = bestBenchFor(state, pos, a.sta)
    if (sub) state = subAthlete(state, AI, sub.uid, pos)
  }

  // 2b. Protect foul trouble: pull anyone one foul from fouling out of a lane
  //     that projects another foul on him.
  if (energy(state) >= SUB_COST) {
    const lanes = computeClash(state)
    for (const lane of lanes) {
      if (energy(state) < SUB_COST) break
      if (!lane.aiFoul) continue
      const a = state.players.ai.lineup[lane.pos]
      if (!a || a.fouls < FOUL_LIMIT - 1) continue
      const sub = bestBenchFor(state, lane.pos, -1)
      if (sub) state = subAthlete(state, AI, sub.uid, lane.pos)
    }
  }

  // 3. One play per possession with leftover energy, in priority order.
  const lanes = computeClash(state)

  // Flop: best when it disqualifies an opponent outright.
  const flop = playInHand(state, 'flop')
  if (flop) {
    for (const pos of POSITIONS) {
      const a = state.players.player.lineup[pos]
      if (a && a.fouls >= FOUL_LIMIT - 1) return playCard(state, AI, flop.id, 'player', pos)
    }
  }

  // Timeout: save a key athlete who is tired with no bench cover.
  const timeout = playInHand(state, 'timeout')
  if (timeout) {
    for (const pos of POSITIONS) {
      const a = state.players.ai.lineup[pos]
      if (a && a.sta <= TIRED_THRESHOLD && !bestBenchFor(state, pos, a.sta)) {
        return playCard(state, AI, timeout.id, AI, pos)
      }
    }
  }

  // Full Court Press when trailing.
  const trailing = state.players.ai.score < state.players.player.score
  const press = playInHand(state, 'fullCourtPress')
  if (press && trailing) return playCard(state, AI, press.id)

  // Clutch Gene on a contested lane the CPU is currently losing.
  const clutch = playInHand(state, 'clutchGene')
  if (clutch) {
    for (const lane of lanes) {
      if (lane.aiHas && lane.playerHas && lane.aiPts === 0) {
        return playCard(state, AI, clutch.id, AI, lane.pos)
      }
    }
  }

  // Zone Defense when the player projects to outscore the CPU this clash.
  const zone = playInHand(state, 'zoneDefense')
  if (zone) {
    const pProj = lanes.reduce((n, l) => n + l.playerPts, 0)
    const aProj = lanes.reduce((n, l) => n + l.aiPts, 0)
    if (pProj > aProj) return playCard(state, AI, zone.id)
  }

  return state
}

// Register with the engine so the reducer can call it without an import cycle.
setAiStrategy(chooseAiTurn)
