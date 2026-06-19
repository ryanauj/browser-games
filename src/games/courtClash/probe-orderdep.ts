/**
 * Throwaway probe (not a gate): is collision resolution ORDER-INDEPENDENT — does
 * the bulled defender's outcome stop depending on which side holds the ball?
 *
 * The checkpoint defect: `applyMovement` iterated a fixed roster
 * [player-0..4, ai-0..4] and `driveCollision` UNCONDITIONALLY overwrote a bulled
 * defender to `defStart + shove`. So the defender's own jog was COMPOUNDED when
 * the player drove (driver iterated first) but DISCARDED when the AI drove
 * (defender iterated first) — a home-side asymmetry from identical inputs.
 *
 * We build ONE physical scenario — a downhill driver bulling a defender who is
 * jogging PERPENDICULAR to the drive — and run it twice with identical geometry:
 * once with the ball on the player side (driver=player-0, def=ai-0) and once on
 * the AI side (driver=ai-0, def=player-0). player-i and ai-i share an archetype
 * (same attrs), so the two runs are mirror-identical inputs. The tell is the
 * defender's PERPENDICULAR (x) displacement: it is his jog. If resolution is
 * order-independent, the bulled defender ends at the same spot on both ball-sides.
 *
 * Run:  esbuild ... probe-orderdep.ts --bundle ... && node ...   (see commands)
 */
import { applyMovement, createInitialState } from './engine'
import { BASKET } from './constants'
import type { GameState, Player } from './types'

/** Park everyone out of the way, then stage a driver + a perpendicular-jogging
 *  defender. `driverSide` picks which team holds the ball; geometry is identical. */
function stage(seed: number, driverSide: 'player' | 'ai'): GameState {
  const s = createInitialState(seed)
  const defSide = driverSide === 'player' ? 'ai' : 'player'
  const players = s.players.map((p, i) => ({
    ...p,
    pos: { x: 5 + i * 8, y: 95 }, // bystanders parked far from the action
    order: { kind: 'idle' } as Player['order'],
    sprintSpeed: 0,
    sprintDir: null as Player['sprintDir'],
    stuck: 0,
    bull: 0,
    primed: 0,
    stamina: 100,
  }))
  const driver = players.find((p) => p.id === `${driverSide}-0`)!
  const def = players.find((p) => p.id === `${defSide}-0`)!
  // Driver downhill toward the rim with momentum already built (forces a bull).
  driver.pos = { x: 50, y: 30 }
  driver.order = { kind: 'drive', to: { ...BASKET } }
  driver.sprintSpeed = 14
  driver.sprintDir = { x: 0, y: -1 }
  // Defender planted in the lane, jogging PERPENDICULAR (+x) — his jog has no
  // overlap with the drive normal (-y), so a kept vs discarded jog is visible.
  def.pos = { x: 50, y: 22 }
  def.order = { kind: 'move', to: { x: 70, y: 22 }, mode: 'jog' }
  return { ...s, players, offense: driverSide, ballHandlerId: driver.id }
}

function runCase(seed: number, driverSide: 'player' | 'ai') {
  const st = stage(seed, driverSide)
  const defSide = driverSide === 'player' ? 'ai' : 'player'
  const defStart = st.players.find((p) => p.id === `${defSide}-0`)!.pos
  const players = st.players.map((p) => ({ ...p, pos: { ...p.pos } }))
  applyMovement(players, st.ballHandlerId)
  const def = players.find((p) => p.id === `${defSide}-0`)!
  return { defStart, defEnd: { ...def.pos } }
}

function run(seed: number) {
  const a = runCase(seed, 'player') // ball on player side (driver iterated first)
  const b = runCase(seed, 'ai') //     ball on AI side    (defender iterated first)
  const dx = Math.abs(a.defEnd.x - b.defEnd.x)
  const dy = Math.abs(a.defEnd.y - b.defEnd.y)
  console.log(`seed ${seed}: bulled defender jogging +x while driven downhill`)
  console.log(`  player-ball  def: (${a.defEnd.x.toFixed(3)}, ${a.defEnd.y.toFixed(3)})  (jog Δx=${(a.defEnd.x - a.defStart.x).toFixed(3)})`)
  console.log(`  ai-ball      def: (${b.defEnd.x.toFixed(3)}, ${b.defEnd.y.toFixed(3)})  (jog Δx=${(b.defEnd.x - b.defStart.x).toFixed(3)})`)
  console.log(`  ball-side delta: |Δx|=${dx.toFixed(4)}  |Δy|=${dy.toFixed(4)}  → ${dx < 1e-9 && dy < 1e-9 ? 'ORDER-INDEPENDENT ✓' : 'ball-side dependent ✗'}\n`)
}

run(5000)
run(-755680012)
run(42)
