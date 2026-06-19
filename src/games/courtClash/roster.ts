import type { Attributes, Player, Side, Vec } from './types'

/** One of the five archetypes that make up a balanced five. Both teams are
 *  dealt the SAME five archetypes (a fair scrimmage) — games diverge through
 *  how you orchestrate the floor, not roster luck. */
interface Archetype {
  role: string
  attr: Attributes
  /** Default offensive spot, expressed for a team attacking the rim. */
  spot: Vec
}

const A = (
  speed: number,
  handle: number,
  finishing: number,
  shooting: number,
  passing: number,
  strength: number,
  perimeterD: number,
  interiorD: number,
): Attributes => ({ speed, handle, finishing, shooting, passing, strength, perimeterD, interiorD })

/** The five archetypes (backcourt → frontcourt), with their home spots. */
const ARCHETYPES: Archetype[] = [
  // PG — Playmaker: runs the show, finds the open man.
  { role: 'Playmaker', attr: A(82, 88, 60, 70, 90, 45, 66, 35), spot: { x: 50, y: 76 } },
  // SG — Sharpshooter: lethal from deep, lighter on D.
  { role: 'Sharpshooter', attr: A(74, 70, 58, 92, 64, 48, 62, 40), spot: { x: 80, y: 58 } },
  // SF — Slasher: attacks the rim, two-way wing.
  { role: 'Slasher', attr: A(88, 76, 84, 68, 66, 64, 78, 58), spot: { x: 20, y: 58 } },
  // PF — Two-Way Forward: strong, guards, cleans the glass.
  { role: 'Two-Way Forward', attr: A(66, 54, 78, 60, 56, 82, 80, 76), spot: { x: 64, y: 30 } },
  // C — Rim Protector: anchors the paint, swats shots.
  { role: 'Rim Protector', attr: A(52, 44, 80, 42, 50, 90, 60, 94), spot: { x: 36, y: 30 } },
]

const PLAYER_NAMES = ['Vega', 'Cole', 'Rhodes', 'Drummond', 'Okafor']
const AI_NAMES = ['Reyes', 'Park', 'Novak', 'Bauer', 'Sokolov']

/** Reflect an offensive spot across the floor for the team whose half-court
 *  attack we mirror. Both teams share one basket, so we offset the defending
 *  layout from the same spots at deal time; here we just place the offense. */
function buildSide(side: Side, names: string[]): Player[] {
  return ARCHETYPES.map((arch, i) => ({
    id: `${side}-${i}`,
    side,
    name: names[i],
    number: [1, 3, 7, 21, 33][i],
    role: arch.role,
    attr: arch.attr,
    pos: { ...arch.spot },
    stamina: 100,
    order: { kind: 'idle' } as const,
    sprintSpeed: 0,
    sprintDir: null,
    stuck: 0,
    screenHeld: 0,
    primed: 0,
    bull: 0,
  }))
}

/** Deal both fives. The team on offense uses the home spots; the defense is
 *  positioned man-up by the engine's initial possession setup. */
export function buildPlayers(): Player[] {
  return [...buildSide('player', PLAYER_NAMES), ...buildSide('ai', AI_NAMES)]
}

export { ARCHETYPES }
