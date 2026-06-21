import { createInitialState, reducer } from './engine'
import { aiPlan } from './ai'
import type { GameState } from './types'

const STEP_CAP = 4500
let drive = 0, gamble = 0, lane = 0, other = 0, poss = 0

for (let g = 0; g < 60; g++) {
  let s: GameState = createInitialState(5000 + g)
  let steps = 0
  while (s.phase === 'play' && steps < STEP_CAP) {
    const pplan = aiPlan(s, 'player')
    for (const o of pplan.orders) s = reducer(s, { type: 'SET_ORDER', playerId: o.playerId, order: o.order })
    s =
      s.offense === 'player' && pplan.shoot
        ? reducer(s, { type: 'CALL_SHOT', playerId: pplan.shoot })
        : reducer(s, { type: 'RUN_STEP' })
    for (const e of s.events) {
      if (e.kind === 'steal') {
        const t = e.text || ''
        if (t.includes('the drive')) drive++
        else if (t.includes('strips it')) gamble++
        else if (t.includes('intercept') || t.includes('picks') || t.includes('lane')) lane++
        else other++
      }
    }
    steps++
  }
  poss += s.possession
}
const games = 60
console.log(`steals/game: drive-strip ${(drive/games).toFixed(1)}  gamble ${(gamble/games).toFixed(1)}  lane ${(lane/games).toFixed(1)}  other ${(other/games).toFixed(1)}`)
console.log(`total ${((drive+gamble+lane+other)/games).toFixed(1)}/game over ${(poss/games).toFixed(1)} poss = ${(((drive+gamble+lane+other)/poss)*100).toFixed(0)}%/poss`)
