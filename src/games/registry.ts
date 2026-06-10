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
      'Draft a lineup of athlete cards across five positions, manage your energy, and race the shot clock. Both squads clash at once — outscore the CPU across four quarters.',
    Component: CourtClash,
  },
]

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id)
}
