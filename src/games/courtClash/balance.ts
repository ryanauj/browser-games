/**
 * Headless balance harness. Self-plays full games (both sides driven by the
 * CPU policy) and reports the numbers we tune against — shot mix, FG% by side,
 * 3-point rate, steals/blocks/shot-clock turnovers, points per possession,
 * whether player defense actually changes outcomes, and the stamina curve.
 *
 * Run:  pnpm balance        (bundles with esbuild + runs on node)
 *
 * It imports only the pure engine, so it's deterministic and fast. Use it to
 * measure a change instead of guessing.
 */
import { createInitialState, reducer, shotMakeChance } from './engine'
import { shotType } from './geometry'
import { aiPlan } from './ai'
import type { GameState, Player, Side, Vec } from './types'

const GAMES = 60
// Steps per game cap — a possession is now ~40-60 steps (Q10), ~3.5× the old
// beat, so the per-game ceiling rises to match.
const STEP_CAP = 4500

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) : '—')
const f1 = (n: number) => n.toFixed(1)

type Tally = {
  layup: number
  two: number
  three: number
  makes: number
  shots: number
  threeMakes: number
  threeShots: number
  steals: number
  blocks: number
  clockTOs: number
}
const emptyTally = (): Tally => ({
  layup: 0,
  two: 0,
  three: 0,
  makes: 0,
  shots: 0,
  threeMakes: 0,
  threeShots: 0,
  steals: 0,
  blocks: 0,
  clockTOs: 0,
})

const note = (t: Tally, s: GameState) => {
  for (const e of s.events) {
    if (e.kind === 'shotMake' || e.kind === 'shotMiss') {
      t.shots++
      if (e.from) {
        const ty = shotType(e.from)
        t[ty]++
        if (ty === 'three') {
          t.threeShots++
          if (e.kind === 'shotMake') t.threeMakes++
        }
      }
      if (e.kind === 'shotMake') t.makes++
    } else if (e.kind === 'steal') t.steals++
    else if (e.kind === 'block') t.blocks++
    else if (e.kind === 'shotclock') t.clockTOs++
  }
}

/** Spread spots at half-court (y≈98) — far from the rim at y≈9, beyond every
 *  contest radius (OPEN_DISTANCE 14, CONTEST_RADIUS 11, PASS_INTERCEPT_RADIUS,
 *  COLLIDE_RADIUS, …). Used to PARK the player's five for the true no-defense
 *  counterfactual (Fix 3). */
const PARK_SPOTS: Vec[] = [
  { x: 10, y: 98 },
  { x: 30, y: 98 },
  { x: 50, y: 98 },
  { x: 70, y: 98 },
  { x: 90, y: 98 },
]

/** Remove `side`'s five from the play: park them at half-court, idle, with no
 *  momentum, so they cannot contest, block, strip, or intercept — a genuinely
 *  OPEN floor for the offense. Mutates the harness state only (never the reducer):
 *  this is the test scaffolding the honest defense-matters baseline needs (Fix 3),
 *  not a rule change. The reducer's setupPossession re-seats them goal-side at each
 *  possession, so this is re-applied every step the measured side is on defense. */
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

/** One self-play beat: set the offense's orders (and shoot if it wants), let the
 *  engine handle the defense's AI internally. `playerPolicy` lets us swap how
 *  the player side behaves for the defense-matters experiment:
 *   - 'ai':   the player plays full CPU defense (the guarded run).
 *   - 'open': a TRUE no-defense counterfactual — whenever the AI is on offense the
 *     player's five are parked at half-court (removed from the play), so the AI
 *     attacks open floor. (Replaces the old 'idle', which left the five sitting
 *     goal-side in their start spots — still clogging lanes and the paint, so it
 *     was "passive defense," not "no defense," and made guarding look like it
 *     RAISED AI scoring. Fix 3.) */
function selfPlayStep(
  s: GameState,
  playerPolicy: 'ai' | 'open' = 'ai',
): GameState {
  if (playerPolicy === 'ai') {
    const pplan = aiPlan(s, 'player')
    for (const o of pplan.orders) s = reducer(s, { type: 'SET_ORDER', playerId: o.playerId, order: o.order })
    if (s.offense === 'player' && pplan.shoot) return reducer(s, { type: 'CALL_SHOT', playerId: pplan.shoot })
  } else if (s.offense === 'ai') {
    parkDefenders(s, 'player') // no-defense baseline: clear the floor for the AI
  }
  return reducer(s, { type: 'RUN_STEP' })
}

function playGame(seed: number, playerPolicy: 'ai' | 'open' = 'ai') {
  let s = createInitialState(seed)
  const by: Record<Side, Tally> = { player: emptyTally(), ai: emptyTally() }
  // Distinct possession indices each side spent on offense — so points can be
  // normalized per-possession (raw point totals are skewed by possession count,
  // e.g. an idle side cycles the ball back fast and inflates the opponent's tally).
  const offPoss: Record<Side, Set<number>> = { player: new Set(), ai: new Set() }
  // Points the AI scored on each of its OWN offensive possessions, IN ORDER. The
  // defense-matters metric reads the first N of these so the guard/no-defense
  // compare is over equal possession samples (the two runs differ in length —
  // against no defense the AI scores fast and the player scores 0 — so this avoids
  // garbage-time trips swamping the average).
  const aiPossPts: number[] = []
  let lastAiPoss = -1
  let prevAiScore = s.score.ai
  let steps = 0
  while (s.phase === 'play' && steps < STEP_CAP) {
    const offense = s.offense
    offPoss[offense].add(s.possession)
    if (offense === 'ai' && s.possession !== lastAiPoss) {
      aiPossPts.push(0) // a new AI offensive trip starts
      lastAiPoss = s.possession
    }
    s = selfPlayStep(s, playerPolicy)
    const dAi = s.score.ai - prevAiScore // points the step just produced (offense scored)
    if (dAi > 0 && offense === 'ai' && aiPossPts.length) aiPossPts[aiPossPts.length - 1] += dAi
    prevAiScore = s.score.ai
    note(by[offense], s) // attribute this step's events to whoever had the ball
    steps++
  }
  const minSta = Math.min(...s.players.map((p) => p.stamina))
  const avgSta = s.players.reduce((a, p) => a + p.stamina, 0) / s.players.length
  return {
    by,
    steps,
    score: s.score,
    possessions: s.possession,
    offPoss: { player: offPoss.player.size, ai: offPoss.ai.size },
    aiPossPts,
    minSta,
    avgSta,
    over: s.phase === 'gameover',
  }
}

function probeOpen(pos: { x: number; y: number }): number {
  const base = createInitialState(1)
  const shooter = base.players.find((p) => p.id === base.ballHandlerId)!
  const lone: Player[] = [{ ...shooter, pos }] // no defenders = fully open
  return shotMakeChance(lone, { ...shooter, pos })
}

function main() {
  console.log('=== OPEN shot make% (no defender) ===')
  console.log(
    `  layup ${pct(probeOpen({ x: 50, y: 12 }), 1)}  |  midrange ${pct(probeOpen({ x: 50, y: 34 }), 1)}` +
      `  |  corner-3 ${pct(probeOpen({ x: 6, y: 14 }), 1)}  |  top-3 ${pct(probeOpen({ x: 50, y: 56 }), 1)}`,
  )

  // --- Self-play, both sides on the CPU policy ---
  const agg = emptyTally()
  let pts = 0
  let poss = 0
  let stepsTot = 0
  let minStaTot = 0
  let avgStaTot = 0
  for (let i = 0; i < GAMES; i++) {
    const g = playGame(5000 + i)
    for (const side of ['player', 'ai'] as Side[]) {
      const t = g.by[side]
      for (const k in agg) (agg as Record<string, number>)[k] += (t as unknown as Record<string, number>)[k]
    }
    pts += g.score.player + g.score.ai
    poss += g.possessions
    stepsTot += g.steps
    minStaTot += g.minSta
    avgStaTot += g.avgSta
  }
  console.log(`\n=== Self-play over ${GAMES} games (both sides CPU) ===`)
  console.log(`  shots=${agg.shots}  FG%=${pct(agg.makes, agg.shots)}`)
  console.log(
    `  shot mix:  layup ${pct(agg.layup, agg.shots)}%  |  two ${pct(agg.two, agg.shots)}%  |  three ${pct(agg.three, agg.shots)}%`,
  )
  console.log(`  3PA share=${pct(agg.three, agg.shots)}%  3P%=${pct(agg.threeMakes, agg.threeShots)}`)
  console.log(`  per game:  steals ${f1(agg.steals / GAMES)}  blocks ${f1(agg.blocks / GAMES)}  shot-clock TOs ${f1(agg.clockTOs / GAMES)}`)
  console.log(`  pace:  ${f1(stepsTot / GAMES)} steps/game,  ${f1(poss / GAMES)} possessions,  ${f1(pts / poss)} pts/possession`)
  console.log(`  stamina at game end:  avg ${f1(avgStaTot / GAMES)}  min ${f1(minStaTot / GAMES)}`)

  // --- Does player defense change AI scoring? guarding (CPU) vs a TRUE no-defense
  //     baseline (the player's five removed from the play), same seeds ---
  //
  // Fix 3: the baseline is now OPEN FLOOR, not "idle." The old idle run left the
  // five sitting goal-side in their start spots — still in passing lanes and
  // clogging the paint — so the offense scored LESS against those passive bodies
  // than against a spread man, making guarding look like it RAISED AI efficiency.
  // The honest counterfactual is "no defender there at all": parkDefenders sends
  // the player's five to half-court so the AI attacks genuinely open floor.
  //
  // The comparison is pts/possession over EQUAL possession samples. A naive
  // "total AI pts / total AI poss" is doubly confounded: (a) the no-defense game
  // ends fast (the AI scores at will) while the player scores 0, so the two runs
  // have very different lengths; (b) garbage-time trips skew the averages. So for
  // each seed we take the FIRST N AI offensive possessions of BOTH runs, where
  // N = the shorter run's AI-possession count — same sample size, no garbage tail.
  let guardPts = 0
  let guardPossN = 0
  let openPts = 0
  let openPossN = 0
  let guardShots = 0
  let guardMakes = 0
  let openShots = 0
  let openMakes = 0
  let guardTotPoss = 0
  let openTotPoss = 0
  for (let i = 0; i < GAMES; i++) {
    const guard = playGame(7000 + i, 'ai')
    const open = playGame(7000 + i, 'open')
    const n = Math.min(guard.aiPossPts.length, open.aiPossPts.length)
    for (let k = 0; k < n; k++) {
      guardPts += guard.aiPossPts[k]
      openPts += open.aiPossPts[k]
    }
    guardPossN += n
    openPossN += n
    guardShots += guard.by.ai.shots
    guardMakes += guard.by.ai.makes
    openShots += open.by.ai.shots
    openMakes += open.by.ai.makes
    guardTotPoss += guard.offPoss.ai
    openTotPoss += open.offPoss.ai
  }
  const guardPP = guardPts / Math.max(1, guardPossN)
  const openPP = openPts / Math.max(1, openPossN)
  // Effect = signed pts/poss swing from guarding vs open floor, as a fraction of
  // the larger of the two rates — bounded to [-100%, +100%]. NEGATIVE = guarding
  // suppresses AI scoring vs open floor (defense working, as you'd expect);
  // positive = guarding somehow RAISES it (the cutoff isn't biting — a real
  // finding to surface, not paper over).
  const effect = ((guardPP - openPP) / Math.max(0.001, guardPP, openPP)) * 100
  console.log(`\n=== Does player defense matter? (AI offense, same ${GAMES} seeds, first-N equal poss) ===`)
  console.log(`  player GUARDS:     ${f1(guardPP)} pts/poss over ${guardPossN} sampled poss  (FG% ${pct(guardMakes, guardShots)})`)
  console.log(`  player NO DEFENSE: ${f1(openPP)} pts/poss over ${openPossN} sampled poss  (FG% ${pct(openMakes, openShots)})   [open floor — five parked at half-court]`)
  console.log(`  => defense effect: ${f1(effect)}%  (${effect <= 0 ? 'guarding SUPPRESSES AI pts/poss vs open floor — defense working' : 'guarding RAISES AI pts/poss vs open floor — defense NOT biting'})`)
  console.log(`     (for reference: AI got ${f1(openTotPoss / GAMES)} poss/game vs no defense vs ${f1(guardTotPoss / GAMES)} guarded)`)
}

main()
