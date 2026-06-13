import type { Attributes } from './types'

export interface AttrMeta {
  key: keyof Attributes
  label: string
  icon: string
}

/** The eight sim attributes, with a glyph + short label for the UI. */
export const ATTR_META: AttrMeta[] = [
  { key: 'speed', label: 'Speed', icon: '💨' },
  { key: 'handle', label: 'Handle', icon: '🏀' },
  { key: 'finishing', label: 'Finish', icon: '🔥' },
  { key: 'shooting', label: 'Shoot', icon: '🎯' },
  { key: 'passing', label: 'Pass', icon: '👁️' },
  { key: 'strength', label: 'Strength', icon: '💪' },
  { key: 'perimeterD', label: 'Perim D', icon: '🧤' },
  { key: 'interiorD', label: 'Rim D', icon: '🛡️' },
]

/** Map a 0..99 attribute to a 1 (cold/weak) → 5 (hot/strong) heat tier. */
export function heatTier(v: number): 1 | 2 | 3 | 4 | 5 {
  if (v < 38) return 1
  if (v < 52) return 2
  if (v < 66) return 3
  if (v < 80) return 4
  return 5
}

/** The player's standout attribute — drives their sprite badge. */
export function signatureAttr(attr: Attributes): AttrMeta {
  let best = ATTR_META[0]
  let bv = -1
  for (const m of ATTR_META) {
    if (attr[m.key] > bv) {
      bv = attr[m.key]
      best = m
    }
  }
  return best
}
