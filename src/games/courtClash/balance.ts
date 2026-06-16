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
import type { GameState, Player, Side } from './types'

const GAMES = 60
const BEAT_CAP = 1200

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

/** One self-play beat: set the offense's orders (and shoot if it wants), let the
 *  engine handle the defense's AI internally. `playerPolicy` lets us swap how
 *  the player side behaves for the defense-matters experiment. */
function selfPlayStep(
  s: GameState,
  playerPolicy: 'ai' | 'idle' = 'ai',
): GameState {
  // Player-side orders every beat (offense or defense).
  if (playerPolicy === 'ai') {
    const pplan = aiPlan(s, 'player')
    for (const o of pplan.orders) s = reducer(s, { type: 'SET_ORDER', playerId: o.playerId, order: o.order })
    if (s.offense === 'player' && pplan.shoot) return reducer(s, { type: 'CALL_SHOT', playerId: pplan.shoot })
  }
  return reducer(s, { type: 'RUN_BEAT' })
}

function playGame(seed: number, playerPolicy: 'ai' | 'idle' = 'ai') {
  let s = createInitialState(seed)
  const by: Record<Side, Tally> = { player: emptyTally(), ai: emptyTally() }
  // Distinct possession indices each side spent on offense — so points can be
  // normalized per-possession (raw point totals are skewed by possession count,
  // e.g. an idle side cycles the ball back fast and inflates the opponent's tally).
  const offPoss: Record<Side, Set<number>> = { player: new Set(), ai: new Set() }
  let beats = 0
  while (s.phase === 'play' && beats < BEAT_CAP) {
    const offense = s.offense
    offPoss[offense].add(s.possession)
    s = selfPlayStep(s, playerPolicy)
    note(by[offense], s) // attribute this beat's events to whoever had the ball
    beats++
  }
  const minSta = Math.min(...s.players.map((p) => p.stamina))
  const avgSta = s.players.reduce((a, p) => a + p.stamina, 0) / s.players.length
  return {
    by,
    beats,
    score: s.score,
    possessions: s.possession,
    offPoss: { player: offPoss.player.size, ai: offPoss.ai.size },
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
  let beatsTot = 0
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
    beatsTot += g.beats
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
  console.log(`  pace:  ${f1(beatsTot / GAMES)} beats/game,  ${f1(poss / GAMES)} possessions,  ${f1(pts / poss)} pts/possession`)
  console.log(`  stamina at game end:  avg ${f1(avgStaTot / GAMES)}  min ${f1(minStaTot / GAMES)}`)

  // --- Does player defense change AI scoring? guarding (CPU) vs idle, same seeds ---
  let aiVsGuard = 0
  let aiVsIdle = 0
  let guardShots = 0
  let guardMakes = 0
  let idleShots = 0
  let idleMakes = 0
  let guardPoss = 0
  let idlePoss = 0
  for (let i = 0; i < GAMES; i++) {
    const guard = playGame(7000 + i, 'ai')
    const idle = playGame(7000 + i, 'idle')
    aiVsGuard += guard.score.ai
    aiVsIdle += idle.score.ai
    guardShots += guard.by.ai.shots
    guardMakes += guard.by.ai.makes
    idleShots += idle.by.ai.shots
    idleMakes += idle.by.ai.makes
    guardPoss += guard.offPoss.ai
    idlePoss += idle.offPoss.ai
  }
  // Per-possession is the honest measure: total AI pts is inflated when the player
  // idles (the AI simply gets far more possessions), so normalize by AI's own
  // offensive trips. The point-total line stays for reference.
  const guardPP = aiVsGuard / Math.max(1, guardPoss)
  const idlePP = aiVsIdle / Math.max(1, idlePoss)
  console.log(`\n=== Does player defense matter? (AI offense, same ${GAMES} seeds) ===`)
  console.log(`  player GUARDS:  AI pts=${aiVsGuard} over ${guardPoss} poss → ${f1(guardPP)} pts/poss  (FG% ${pct(guardMakes, guardShots)})`)
  console.log(`  player IDLE:    AI pts=${aiVsIdle} over ${idlePoss} poss → ${f1(idlePP)} pts/poss  (FG% ${pct(idleMakes, idleShots)})`)
  console.log(`  => defense effect: ${f1(((idlePP - guardPP) / Math.max(0.001, idlePP)) * 100)}% fewer AI pts/possession when guarding`)
  console.log(`     (raw point-total delta: ${f1(((aiVsIdle - aiVsGuard) / Math.max(1, aiVsIdle)) * 100)}% — inflated by possession count)`)
}

main()
