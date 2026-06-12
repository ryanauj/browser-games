import type { ComponentType } from 'react'
import CourtClash from './courtClash'

export interface GameEntry {
  /** URL slug used in the hash route, e.g. #/court-clash */
  id: string
  title: string
  tagline: string
  description: string
  Component: ComponentType
}

/**
 * The catalogue of playable games. Add a new game by dropping a folder under
 * src/games/<game>/ that default-exports its root component, then registering
 * it here — the landing page and hash router pick it up automatically.
 */
export const GAMES: GameEntry[] = [
  {
    id: 'court-clash',
    title: 'Court Clash',
    tagline: '5v5 basketball strategy card battler',
    description:
      'Draft athlete cards into five positional lanes against a CPU coach who plays first, in the open. Read the live lane projections, bend them with power-ups, and resolve the clash — outscore the CPU across four quarters. Optional real-time shot clock for extra pressure.',
    Component: CourtClash,
  },
]

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id)
}
