/* Probe for the off-ball verbs (Q19 screens, Q20 steals). The AI planner does not
 * yet reliably PLANT a screen or issue a `steal` order, so these verbs aren't
 * exercised by self-play (`pnpm balance`); this constructs controlled scenarios to
 * prove the mechanic + its determinism. Not a hard gate. Run via esbuild like the
 * other probes:  esbuild ... probe-screensteal.ts | node
 */
import { createInitialState, reducer } from './engine'
import type { GameState, Player } from './types'

declare const process: { exit(code: number): never }

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s))
const pById = (s: GameState, id: string): Player => s.players.find((p) => p.id === id)!
const det = (s: GameState): boolean =>
  JSON.stringify(reducer(clone(s), { type: 'RUN_STEP' })) === JSON.stringify(reducer(clone(s), { type: 'RUN_STEP' }))

// --- Screen: legal pick (screener SET next to the marked defender) ------------
function legalScreen() {
  const s = createInitialState(1)
  const off = s.players.filter((p) => p.side === 'player')
  const def = s.players.filter((p) => p.side === 'ai')
  const screener = pById(s, off[1].id)
  const mark = pById(s, def[2].id)
  mark.pos = { x: 50, y: 50 }
  mark.order = { kind: 'help', to: { x: 50, y: 50 } } // not guarding the screener
  screener.pos = { x: 50, y: 55 } // ~5 away → body contact
  screener.order = { kind: 'screen', to: { ...mark.pos }, markId: mark.id }
  screener.screenHeld = 5 // already established (SET)
  const ns = reducer(s, { type: 'RUN_STEP' })
  return { stuck: pById(ns, mark.id).stuck, fouled: ns.events.some((e) => /Moving screen/.test(e.text)), det: det(s) }
}

// --- Screen: illegal moving screen (screener in contact, NOT set) -------------
function movingScreen() {
  const s = createInitialState(1)
  const off = s.players.filter((p) => p.side === 'player')
  const def = s.players.filter((p) => p.side === 'ai')
  const screener = pById(s, off[1].id)
  const mark = pById(s, def[2].id)
  mark.pos = { x: 50, y: 50 }
  mark.order = { kind: 'help', to: { x: 50, y: 50 } }
  screener.pos = { x: 50, y: 54 } // body contact ...
  screener.order = { kind: 'screen', to: { ...mark.pos }, markId: mark.id }
  screener.screenHeld = 0 // ... but NOT set — still moving in
  const ns = reducer(s, { type: 'RUN_STEP' })
  return { fouled: ns.events.some((e) => /Moving screen/.test(e.text)), flipped: ns.offense !== s.offense, det: det(s) }
}

// --- Steal: a PLAYER-side defender gambles vs an AI ball handler. The player side
//     is not overwritten by aiPlan, so its `steal` order persists. ------------
function steal(seed: number) {
  const s = createInitialState(seed)
  s.offense = 'ai'
  const ai = s.players.filter((p) => p.side === 'ai')
  const pl = s.players.filter((p) => p.side === 'player')
  const handler = ai[0]
  s.ballHandlerId = handler.id
  handler.pos = { x: 50, y: 24 }
  handler.order = { kind: 'idle' }
  // park the AI's other four far away so the planner just holds (no pass/shot churn)
  for (let i = 1; i < ai.length; i++) ai[i].pos = { x: 10 + i * 4, y: 90 }
  const thief = pl[0]
  thief.pos = { x: 50, y: 18 } // in the drive lane (handler→basket) → stays engaged
  thief.order = { kind: 'steal', markId: handler.id }
  for (let i = 1; i < pl.length; i++) pl[i].pos = { x: 90, y: 90 - i * 4 } // others out of the way
  const ns = reducer(s, { type: 'RUN_STEP' })
  const stole = ns.offense === 'player'
  const t = pById(ns, thief.id)
  return { stole, thiefStuck: t.stuck, det: det(s) }
}

const ls = legalScreen()
console.log(`LEGAL screen:   mark.stuck=${ls.stuck} (expect>0)  fouled=${ls.fouled}  det=${ls.det}`)
const ms = movingScreen()
console.log(`MOVING screen:  fouled=${ms.fouled}  possession-flipped=${ms.flipped}  det=${ms.det}`)

let stole = 0, missStuck = 0, bad = 0
for (let i = 0; i < 400; i++) {
  const r = steal(2000 + i)
  if (!r.det) bad++
  if (r.stole) stole++
  else if (r.thiefStuck > 0) missStuck++
}
console.log(`STEAL gamble (400 seeds): stole=${stole}  beaten-on-miss(stuck applied)=${missStuck}  non-deterministic=${bad}`)
process.exit(bad > 0 ? 1 : 0)
