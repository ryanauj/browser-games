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
    tagline: 'Be the floor general in half-court 5v5',
    description:
      'Real-time, beat-by-beat half-court hoops. You direct all five of your players — call screens, cuts, drives and passes on offense, switch, double and help on defense — and the outcome turns on how open you get the floor. Read the risk glow, ride your stamina, and beat the CPU first to 15.',
    Component: CourtClash,
  },
]

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id)
}
