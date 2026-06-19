/**
 * Throwaway probe (not a gate): does the STEP model close the guard-lag and
 * phantom-through bugs the doc's "Why this rework" section cites?
 *
 * Guard-lag (doc, seed -755680012): under the single-shot beat the on-ball man
 * aimed at the handler's START-of-beat spot and resolved before the handler
 * moved, so a burst drive covered ~35.6 units while the defender moved ~3.3 —
 * gap 23.3 after ONE beat. Here we drive the handler at the rim and print, every
 * STEP, the handler↔guard gap and how far each moved, so we can see whether the
 * gap blows out or the guard stays attached step-by-step.
 *
 * Run:  esbuild ... probe-guardlag.ts --bundle ... && node ...   (see commands)
 */
import { createInitialState, reducer } from './engine'
import { BASKET } from './constants'
import { dist } from './geometry'
import type { GameState } from './types'

function handlerAndGuard(s: GameState) {
  const h = s.players.find((p) => p.id === s.ballHandlerId)!
  // Matchup is by archetype index; ai-0 guards player-0.
  const g = s.players.find((p) => p.id === `ai-${h.id.split('-')[1]}`)!
  return { h, g }
}

function run(seed: number, steps: number) {
  let s = createInitialState(seed)
  const { h: h0 } = handlerAndGuard(s)
  // Commit the handler to a rim sprint; everyone else holds standing orders.
  s = reducer(s, { type: 'SET_ORDER', playerId: h0.id, order: { kind: 'drive', to: { ...BASKET } } })

  console.log(`seed ${seed} — handler ${h0.id} sprints the rim; guard = ai-${h0.id.split('-')[1]}`)
  console.log('step |  gap  | hMoved | gMoved | hSprint | h→rim | note')
  const startPoss = s.possession
  let cumH = 0
  let cumG = 0
  for (let i = 1; i <= steps; i++) {
    const before = handlerAndGuard(s)
    s = reducer(s, { type: 'RUN_STEP' })
    if (s.possession !== startPoss) {
      // possession ended (made basket / turnover / shot-clock) — the drive's over.
      console.log(`  (possession ended at step ${i})`)
      break
    }
    const { h, g } = handlerAndGuard(s)
    const hMoved = dist(before.h.pos, h.pos)
    const gMoved = dist(before.g.pos, g.pos)
    cumH += hMoved
    cumG += gMoved
    const gap = dist(h.pos, g.pos)
    // Phantom-through check: did the handler cross to the rim-side of the guard
    // without contact resolving (guard not shoved)? Flag if handler passed the
    // guard's y while still > a torso away laterally.
    const note = h.pos.y < g.pos.y - 2 && Math.abs(h.pos.x - g.pos.x) > 5 ? 'handler slipped goalside' : ''
    console.log(
      `${String(i).padStart(4)} | ${gap.toFixed(1).padStart(5)} | ${hMoved.toFixed(2).padStart(6)} | ${gMoved
        .toFixed(2)
        .padStart(6)} | ${h.sprintSpeed.toFixed(2).padStart(7)} | ${dist(h.pos, BASKET).toFixed(1).padStart(5)} | ${note}`,
    )
  }
  console.log(`cumulative over the drive: handler moved ${cumH.toFixed(1)}, guard moved ${cumG.toFixed(1)}\n`)
}

run(-755680012, 8)
run(5000, 8)
