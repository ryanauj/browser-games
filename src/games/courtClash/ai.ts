import { POSITIONS } from './constants'
import { playAthlete, playPowerUp, setAiStrategy } from './engine'
import type { AthleteCard, GameState, PowerUpCard, Position } from './types'

/**
 * Greedy CPU coach. Pure: takes a state and returns a new state with the AI's
 * plays applied for this possession. Strategy:
 *   1. Spend a Fast Break early if it unlocks an athlete it can't yet afford.
 *   2. Fill empty slots with the best-value athlete, favouring on-position fit.
 *   3. Tech Foul the opponent's biggest offensive threat.
 *   4. Full Court Press when trailing; Clutch Gene / Zone Defense with spare energy.
 */

const AI: 'ai' = 'ai'
const OPP: 'player' = 'player'

function aiEnergy(state: GameState): number {
  return state.players.ai.energy
}

function emptySlots(state: GameState): Position[] {
  return POSITIONS.filter((pos) => state.players.ai.lineup[pos] === null)
}

function athletesInHand(state: GameState): AthleteCard[] {
  return state.players.ai.hand.filter((c): c is AthleteCard => c.kind === 'athlete')
}

function powerUpsInHand(state: GameState): PowerUpCard[] {
  return state.players.ai.hand.filter((c): c is PowerUpCard => c.kind === 'powerup')
}

/** Heuristic value of placing a card in a slot. */
function placementValue(card: AthleteCard, slot: Position): number {
  const fit = card.position === slot ? 4 : -4
  return card.off + card.def + card.sta * 0.5 + fit
}

function deployBestAthlete(state: GameState): GameState | null {
  const energy = aiEnergy(state)
  const slots = emptySlots(state)
  if (slots.length === 0) return null

  let best: { card: AthleteCard; slot: Position; value: number } | null = null
  for (const card of athletesInHand(state)) {
    if (card.cost > energy) continue
    for (const slot of slots) {
      const value = placementValue(card, slot)
      if (!best || value > best.value) best = { card, slot, value }
    }
  }
  if (!best) return null
  return playAthlete(state, AI, best.card.id, best.slot)
}

/** Slot of the opponent's highest-offense deployed athlete, if any. */
function biggestThreat(state: GameState): Position | null {
  let best: { slot: Position; off: number } | null = null
  for (const pos of POSITIONS) {
    const a = state.players[OPP].lineup[pos]
    if (a && (!best || a.card.off > best.off)) best = { slot: pos, off: a.card.off }
  }
  return best && best.off >= 4 ? best.slot : null
}

/** Slot of the AI's highest-offense deployed athlete, if any. */
function bestScorerSlot(state: GameState): Position | null {
  let best: { slot: Position; off: number } | null = null
  for (const pos of POSITIONS) {
    const a = state.players[AI].lineup[pos]
    if (a && (!best || a.card.off > best.off)) best = { slot: pos, off: a.card.off }
  }
  return best ? best.slot : null
}

function hasPowerUp(state: GameState, effect: PowerUpCard['effect']): PowerUpCard | undefined {
  return powerUpsInHand(state).find((p) => p.effect === effect && p.cost <= aiEnergy(state))
}

export function chooseAiTurn(initial: GameState): GameState {
  let state = initial

  // 1. Fast Break energy if it unlocks an otherwise-unaffordable athlete.
  const fb = hasPowerUp(state, 'fastBreakEnergy')
  if (fb) {
    const e = aiEnergy(state)
    const unlocks = athletesInHand(state).some((c) => c.cost > e && c.cost <= e + 2)
    if (unlocks) state = playPowerUp(state, AI, fb.id)
  }

  // 2. Deploy athletes greedily until nothing is affordable/placeable.
  for (let guard = 0; guard < 5; guard++) {
    const next = deployBestAthlete(state)
    if (!next || next === state) break
    state = next
  }

  // 3. Tech Foul the biggest opposing threat.
  const tech = hasPowerUp(state, 'techFoul')
  if (tech) {
    const threat = biggestThreat(state)
    if (threat) state = playPowerUp(state, AI, tech.id, OPP, threat)
  }

  // 4. Full Court Press when trailing and the opponent has bodies on the floor.
  const trailing = state.players[AI].score <= state.players[OPP].score
  const oppHasBoard = POSITIONS.some((pos) => state.players[OPP].lineup[pos])
  const fcp = hasPowerUp(state, 'fullCourtPress')
  if (fcp && trailing && oppHasBoard) state = playPowerUp(state, AI, fcp.id)

  // 5. Clutch Gene on the AI's best scorer with spare energy.
  const clutch = hasPowerUp(state, 'clutchGene')
  if (clutch) {
    const slot = bestScorerSlot(state)
    if (slot) state = playPowerUp(state, AI, clutch.id, AI, slot)
  }

  // 6. Zone Defense if the AI is fielding a real lineup.
  const zone = hasPowerUp(state, 'zoneDefense')
  const aiBodies = POSITIONS.filter((pos) => state.players[AI].lineup[pos]).length
  if (zone && aiBodies >= 2) state = playPowerUp(state, AI, zone.id)

  return state
}

// Register with the engine so the reducer can call it without an import cycle.
setAiStrategy(chooseAiTurn)
