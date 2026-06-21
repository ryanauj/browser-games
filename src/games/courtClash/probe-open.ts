import { createInitialState, reducer } from './engine'
import { shotType } from './geometry'
import type { GameState, Side, Vec } from './types'

const STEP_CAP = 4500
const PARK_SPOTS: Vec[] = [
  { x: 10, y: 98 }, { x: 30, y: 98 }, { x: 50, y: 98 }, { x: 70, y: 98 }, { x: 90, y: 98 },
]
function parkDefenders(s: GameState, side: Side): void {
  let i = 0
  for (const p of s.players) {
    if (p.side !== side) continue
    p.pos = { ...PARK_SPOTS[i % PARK_SPOTS.length] }
    p.order = { kind: 'idle' }
    p.sprintSpeed = 0
    p.sprintDir = null
    i++
  }
}

const mix = { layup: 0, two: 0, three: 0 }
const makes = { layup: 0, two: 0, three: 0 }
let attempts = 0
let aiPts = 0
let aiPoss = new Set<number>()

for (let g = 0; g < 60; g++) {
  let s = createInitialState(7000 + g)
  let steps = 0
  let prev = s.score.ai
  while (s.phase === 'play' && steps < STEP_CAP) {
    const offense = s.offense
    if (offense === 'ai') { parkDefenders(s, 'player'); aiPoss.add(g * 1000 + s.possession) }
    s = reducer(s, { type: 'RUN_STEP' })
    for (const e of s.events) {
      if ((e.kind === 'shotMake' || e.kind === 'shotMiss') && e.from && offense === 'ai') {
        const ty = shotType(e.from)
        mix[ty]++
        if (e.kind === 'shotMake') makes[ty]++
        attempts++
      }
    }
    aiPts += s.score.ai - prev
    prev = s.score.ai
    steps++
  }
}
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) : '—')
console.log('=== AI OPEN-FLOOR shot breakdown (player parked) ===')
console.log(`  total AI shots: ${attempts}  pts/poss ${(aiPts / aiPoss.size).toFixed(2)}`)
console.log(`  layup ${pct(mix.layup, attempts)}% (make ${pct(makes.layup, mix.layup)})`)
console.log(`  two   ${pct(mix.two, attempts)}% (make ${pct(makes.two, mix.two)})`)
console.log(`  three ${pct(mix.three, attempts)}% (make ${pct(makes.three, mix.three)})`)
console.log(`  FG% ${pct(makes.layup + makes.two + makes.three, attempts)}`)
