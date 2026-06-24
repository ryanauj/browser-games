/**
 * DETERMINISTIC-REPLAY GATE (Q27). The ONE hard correctness check for the
 * movement rework: same seed + same inputs ⇒ byte-identical game, every step.
 *
 * The rework structurally depends on this — a pure reducer whose sub-steps replay
 * exactly (all new state, e.g. `sprintSpeed`/`sprintDir`, lives in the serialized
 * `GameState`). If this goes red, that's a NON-DETERMINISM bug (a stray
 * Date.now / Math.random, an unstable Map/Set iteration, mutation leaking across
 * a snapshot), not a balance opinion — fix it before anything else. Every balance
 * metric in `pnpm balance` is advisory; this is not.
 *
 * Run:  pnpm determinism      (bundles with esbuild + runs on node; exit 1 = red)
 *
 * Three independent checks, over many seeds:
 *   A. Self-play twice from the same seed → identical state JSON at every step.
 *      (Catches non-determinism in the WHOLE loop, incl. the placeholder AI.)
 *   B. Record the exact Action stream of one self-play, then replay it into a
 *      FRESH reducer → identical states. (Proves the reducer is a pure function
 *      of (seed, actions) — no hidden coupling to call order or prior runs.)
 *   C. A scripted human-style game (fixed SET_ORDER + RUN_STEP/CALL_SHOT script)
 *      replayed twice → identical. (Exercises mid-step re-steers / bails that the
 *      AI self-play may not, e.g. flipping a sprint target to pay the redirect.)
 */
import { createInitialState, reducer, shouldHalt } from './engine'
import { aiPlan } from './ai'
import { BASKET, HALT_STEP_CAP } from './constants'
import type { Action, GameState, Order } from './types'

// Node's `process` at runtime (esbuild bundles this for node); declared here so
// the gate typechecks without pulling in @types/node.
declare const process: { exit(code: number): never }

const STEP_CAP = 4000

/** The whole serialized game, as the replay invariant sees it. Stringifying the
 *  entire state (players incl. sprintSpeed/sprintDir, rngState, clock, events,
 *  log) is the strongest possible equality — any drift anywhere shows up. */
const snap = (s: GameState): string => JSON.stringify(s)

/** A self-play run: the exact reducer Action stream + a snapshot after EACH
 *  action (per-action, so it lines up byte-for-byte with a replay). */
interface Run {
  actions: Action[]
  states: string[] // states[0] = initial; states[i+1] = after actions[i]
}

/** Self-play a whole game, recording every reducer Action and the state after
 *  each. Per-step the AI emits several SET_ORDERs then a RUN_STEP/CALL_SHOT.
 *  Mirrors balance.selfPlayStep. */
function playGame(seed: number): Run {
  let s = createInitialState(seed)
  const run: Run = { actions: [], states: [snap(s)] }
  const apply = (a: Action) => {
    run.actions.push(a)
    s = reducer(s, a)
    run.states.push(snap(s))
  }
  let steps = 0
  while (s.phase === 'play' && steps < STEP_CAP) {
    const pplan = aiPlan(s, 'player')
    for (const o of pplan.orders) apply({ type: 'SET_ORDER', playerId: o.playerId, order: o.order })
    if (s.offense === 'player' && pplan.shoot) apply({ type: 'CALL_SHOT', playerId: pplan.shoot })
    else apply({ type: 'RUN_STEP' })
    steps++
  }
  return run
}

/** Replay a fixed Action stream into a fresh reducer from `seed`, snapshotting
 *  after each action (aligned with Run.states). */
function replay(seed: number, actions: Action[]): string[] {
  let s = createInitialState(seed)
  const states: string[] = [snap(s)]
  for (const a of actions) {
    s = reducer(s, a)
    states.push(snap(s))
  }
  return states
}

/** Compare two snapshot streams; return the first index that differs, or -1. */
function firstDiff(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

/** A scripted human-style possession script: re-steers / bails that stress the
 *  redirect + accel paths the AI self-play might not hit. Targets are fixed
 *  spots so the script is identical every run. */
function scriptedActions(seed: number): Action[] {
  // Built against the initial possession (player on offense, off[0] = handler).
  const s0 = createInitialState(seed)
  const off = s0.players.filter((p) => p.side === 'player')
  const handler = off[0].id
  const wing = off[2].id
  const corner: Order = { kind: 'move', to: { x: 8, y: 15 }, mode: 'jog' }
  const sprintRim: Order = { kind: 'drive', to: { ...BASKET } }
  const a: Action[] = []
  // 1) commit the handler to a rim sprint and a wing to a jog relocation
  a.push({ type: 'SET_ORDER', playerId: handler, order: sprintRim })
  a.push({ type: 'SET_ORDER', playerId: wing, order: corner })
  a.push({ type: 'RUN_STEP' })
  a.push({ type: 'RUN_STEP' })
  a.push({ type: 'RUN_STEP' })
  // 2) BAIL the handler's sprint hard the other way (pays angle×speed, resets ramp)
  a.push({ type: 'SET_ORDER', playerId: handler, order: { kind: 'move', to: { x: 90, y: 60 }, mode: 'sprint' } })
  a.push({ type: 'RUN_STEP' })
  a.push({ type: 'RUN_STEP' })
  // 3) downgrade to a jog re-aim, then hold (arrive)
  a.push({ type: 'SET_ORDER', playerId: handler, order: { kind: 'move', to: { x: 50, y: 40 }, mode: 'jog' } })
  for (let i = 0; i < 8; i++) a.push({ type: 'RUN_STEP' })
  return a
}

/** Mid-game states sampled along a self-play game (every `every` steps), so the
 *  auto-run check exercises varied configurations — handler driving, ball in
 *  flight, a shot windup, fresh possessions. */
function sampleStates(seed: number, every: number): GameState[] {
  let s = createInitialState(seed)
  const out: GameState[] = [s]
  let steps = 0
  while (s.phase === 'play' && steps < STEP_CAP) {
    const pplan = aiPlan(s, 'player')
    for (const o of pplan.orders) s = reducer(s, { type: 'SET_ORDER', playerId: o.playerId, order: o.order, queue: o.queue })
    s = s.offense === 'player' && pplan.shoot ? reducer(s, { type: 'CALL_SHOT', playerId: pplan.shoot }) : reducer(s, { type: 'RUN_STEP' })
    steps++
    if (steps % every === 0) out.push(s)
  }
  return out
}

/** A state with deliberately DEEP plan-ahead chains: the player's five each get a
 *  committed sprint chain to a far spot, so no one is "out of plan" for many steps
 *  — forcing RUN_UNTIL_HALT to actually fast-forward (N≫1), the case that proves
 *  the loop isn't a trivial single step. The AI defends (guard never
 *  self-terminates, so it doesn't halt the loop). */
function deepQueueState(seed: number): GameState {
  let s = createInitialState(seed)
  const off = s.players.filter((p) => p.side === 'player')
  // Far half-court spots, away from the rim and contact — a jog relocation (no
  // bull, no strip, no shot), so the only thing that ends the fast-forward is the
  // chain draining or the shot clock: a long, clean auto-run.
  const spots: { x: number; y: number }[] = [
    { x: 50, y: 92 },
    { x: 14, y: 88 },
    { x: 86, y: 88 },
    { x: 30, y: 80 },
    { x: 70, y: 80 },
  ]
  off.forEach((p, i) => {
    const order: Order = { kind: 'move', to: spots[i % spots.length], mode: 'jog' }
    s = reducer(s, { type: 'SET_ORDER', playerId: p.id, order, queue: Array<Order>(12).fill(order) })
  })
  return s
}

/** Run RUN_UNTIL_HALT, and INDEPENDENTLY the equivalent loop of single RUN_STEPs
 *  under the same stop rule + cap (shouldHalt / HALT_STEP_CAP). The two must reach
 *  a byte-identical state — i.e. the auto-run is exactly N successive RUN_STEPs and
 *  introduces no new nondeterminism. Returns the snapshots and the manual step
 *  count (which the auto-run necessarily matches when the snapshots agree). */
function autoVsManual(s0: GameState): { auto: string; manual: string; steps: number } {
  const auto = snap(reducer(s0, { type: 'RUN_UNTIL_HALT' }))
  let s = s0
  let n = 0
  if (s.phase === 'play') {
    do {
      s = reducer(s, { type: 'RUN_STEP' })
      n++
    } while (s.phase === 'play' && n < HALT_STEP_CAP && !shouldHalt(s))
  }
  return { auto, manual: snap(s), steps: n }
}

function main() {
  const seeds = [1, 2, 7, 42, 1234, -755680012, 99999, 5000, 7000, 8675309]
  let failures = 0
  let maxAutoSteps = 0

  for (const seed of seeds) {
    // A. self-play twice → identical
    const r1 = playGame(seed)
    const r2 = playGame(seed)
    const dA = firstDiff(r1.states, r2.states)
    // B. replay the recorded stream into a fresh reducer → identical
    const b = replay(seed, r1.actions)
    const dB = firstDiff(r1.states, b)
    // C. scripted human game, replayed twice → identical
    const script = scriptedActions(seed)
    const c1 = replay(seed, script)
    const c2 = replay(seed, script)
    const dC = firstDiff(c1, c2)

    // D. AUTO-RUN ≡ STEP-LOOP. RUN_UNTIL_HALT must produce a byte-identical state to
    //    the equivalent run of single RUN_STEPs under the same halt rule — the
    //    auto-run introduces NO new nondeterminism (a separate hard gate, per the P1
    //    spec). Checked from many sampled mid-game states (driving, in-flight,
    //    windups, fresh possessions), a deep-queue fast-forward (forces N≫1), and a
    //    salient-flag-on variant (the opt-in halt tier).
    let dD = -1
    let dDsteps = 0
    const states: GameState[] = [...sampleStates(seed, 17), deepQueueState(seed)]
    for (let i = 0; i < states.length && dD === -1; i++) {
      const v = autoVsManual(states[i])
      if (v.auto !== v.manual) {
        dD = i
        dDsteps = v.steps
      } else if (v.steps > maxAutoSteps) maxAutoSteps = v.steps
    }
    // Salient-flag-on variant: arm both sides' opt-in tier and re-check equivalence.
    if (dD === -1) {
      const armed = states.map((s) => ({ ...s, haltOnSalient: { player: true, ai: true } }))
      for (let i = 0; i < armed.length && dD === -1; i++) {
        const v = autoVsManual(armed[i])
        if (v.auto !== v.manual) {
          dD = states.length + i
          dDsteps = v.steps
        }
      }
    }

    const ok = dA === -1 && dB === -1 && dC === -1 && dD === -1
    if (!ok) {
      failures++
      console.log(`✗ seed ${seed}: self-play@${dA}  replay@${dB}  scripted@${dC}  auto-run@${dD}(n=${dDsteps})  (actions=${r1.actions.length})`)
      const [x, y, d] = dA !== -1 ? [r1.states, r2.states, dA] : dB !== -1 ? [r1.states, b, dB] : [c1, c2, dC]
      if (d !== -1) {
        console.log(`   expected: ${x[d]?.slice(0, 240)}`)
        console.log(`   actual:   ${y[d]?.slice(0, 240)}`)
      }
    } else {
      console.log(`✓ seed ${seed}: ${r1.actions.length} actions — self-play, replay, scripted & auto-run≡step-loop all byte-identical`)
    }
  }

  if (failures > 0) {
    console.log(`\nDETERMINISM GATE: RED — ${failures}/${seeds.length} seeds diverged. Fix before continuing.`)
    process.exit(1)
  }
  if (maxAutoSteps <= 1) {
    // The auto-run equivalence is trivially true if RUN_UNTIL_HALT never advances
    // more than one step. Guard against a vacuous gate: at least one scenario must
    // fast-forward (the deep-queue state is built to).
    console.log(`\nDETERMINISM GATE: RED — auto-run never fast-forwarded (maxAutoSteps=${maxAutoSteps}); the equivalence check is vacuous.`)
    process.exit(1)
  }
  console.log(`\nDETERMINISM GATE: GREEN — ${seeds.length} seeds replay byte-identical (incl. auto-run≡step-loop, fast-forward up to ${maxAutoSteps} steps).`)
}

main()
