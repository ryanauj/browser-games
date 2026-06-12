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
    tagline: 'Coach a 5v5 basketball card battler',
    description:
      'You are the coach: five on the floor at all times, a bench to rotate, and a playbook to call. Manage stamina and foul trouble, read the live lane projections, and out-rotate the CPU coach across four quarters. Optional real-time shot clock for extra pressure.',
    Component: CourtClash,
  },
]

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id)
}
