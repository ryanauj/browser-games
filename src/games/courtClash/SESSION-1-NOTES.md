# Court Clash — Movement Rework, Session 1: core step engine

Foundation slice only (Phases 1–2 of the rework): the step-based engine, the new
order/state schema, and the determinism harness. **No** AI behavior, actions
(shots/passes/screens/steals), or UI polish — those are later sessions. The doc
(`MOVEMENT-REWORK.md`, Q1–Q29) is the source of truth.

## What landed

- **Step model (Q10/Q11).** The beat is gone as the logical atomic unit — the
  **step** is atomic and the shot clock counts steps (`GameState.step`,
  `SHOT_CLOCK_STEPS = 45`, `Action: 'RUN_STEP'`). Each tap advances exactly one
  step (turn-based). Magnitudes are the old per-beat values ÷ ~3.5 so pace stays
  roughly constant. "Beat" survives only as the render-glide duration (`BEAT_MS`)
  and the resolution event type (`BeatEvent`), not as time.
- **Order schema (Q13).** `move` now carries `mode: 'jog' | 'sprint'` + target.
  Default between taps is **move-to-target-then-hold** (Q12): a movement order
  persists and the player decelerates/stops on arrival (`ARRIVE_EPS`) instead of
  dropping to idle. `drive`/`cut` retained as sprint specializations (see Q28).
- **Accel ramp (Q4/Q23).** Sprinting toward an unchanged target accelerates per
  step toward a top speed (`SPRINT_TOP_FACTOR`); ramp rate derived from the
  existing `speed` attr (`accelFracOf`, no new attribute). Jog is flat, no
  momentum. Current sprint speed is per-player serialized state
  (`Player.sprintSpeed`, with `Player.sprintDir` for the bail angle).
- **Redirect cost + free re-plan (Q5/Q24).** Any player can be re-steered any
  step (no hard lock). Bailing a sprint onto a new heading pays an **angle×speed**
  penalty that **resets the accel ramp** and doubles as the stamina tax. A gentle
  curve (< `REDIRECT_FREE_ANGLE`) is free; a hard cut at speed is brutal.
- **Continuous per-step collision/separation.** `driveCollision`, `contestedStep`
  and `separateBodies` now run on the fine step, so the defender closes against
  the handler's *incremental* position every step — the guard-lag and
  phantom-through windows can't open up (see "Does it fix the bugs?" below).
- **Momentum→bull coupling (Q22).** `driveCollision` reads the driver's tracked
  **pre-contact** `sprintSpeed` as the momentum term
  (`COLLIDE_BULL_MOMENTUM × sprintSpeed`), replacing `COLLIDE_DRIVE_MOMENTUM ×
  stepLen`. A long committed runway is a heavy bull; a standing/cutting man a
  light one. Coefficient retuned (rough — tuning is later).
- **Simultaneous resolution (Q16).** The AI plans from the revealed (last-step)
  positional state only (the placeholder reads positions/stamina, never the
  human's order committed this step); movement applies to everyone from
  start-of-step positions, **deterministic via the fixed iteration order**
  (`separateBodies` iterates in fixed array order with fixed math for a
  deterministic tie-break). *(Correction: Session 1 was deterministic but NOT yet
  order-independent — the single-pass loop let a bulled defender's jog be
  compounded or discarded by ball-side, and off-ball `contestedStep` read live
  positions. **True order-independence was added in the two-phase resolve (Q30,
  next session).**)*
- **Stamina shape (Q26).** `STAMINA_COST` is now per-step **by mode** (`idle`
  recovers, `jog` cheap, `sprint` drains ∝ current speed); a step that barely
  moved recovers like idle; the Q5 redirect tax is added on a bail. Magnitudes
  left rough on purpose — tuning is a later session.

## Where the placeholder AI is

`ai.ts` → `aiPlan`, flagged with a `⚠️ PLACEHOLDER AI` banner at the top of the
function. It is the OLD per-step greedy floor general, adapted minimally: `move`
orders now carry an explicit jog mode, the handler's `drive` is the sprint verb.
It **re-decides every step and holds no committed intent**, so by the model it
can't build sprint speed the way the rework intends (re-targeting resets the
ramp). That's fine for exercising the engine; the real committed-intent +
predictive-rollout planner is **Q25, a later session**. Do not mistake this for
the rework's AI.

## New decisions recorded (in `MOVEMENT-REWORK.md`)

- **Q28** — Retain `drive`/`cut` as sprint-mode specializations (they ride the
  same accel/redirect/momentum machinery via `moveModeOf`); defer the literal
  verb deletion to the actions session, which reworks the semantics they carry.
- **Q29** — Only a sprint→new-heading **turn** pays the Q5 angle×speed tax; a
  straight decel/stop to a jog (or on arrival) is free (consistent with Q12).

## Determinism gate (Q27 — the ONLY hard gate)

`pnpm determinism` — new always-on harness. Three checks over 10 seeds:
(A) self-play twice → identical, (B) record the action stream and replay it into a
fresh reducer → identical, (C) a scripted human game (with mid-sprint bails that
stress the redirect path) replayed twice → identical. It stringifies the **whole**
`GameState` (incl. `sprintSpeed`/`sprintDir`/`rngState`) per action and exits 1 on
any drift. **Currently GREEN** — all 10 seeds byte-identical. Run it after every
change; red = a non-determinism bug, fix before continuing.

(A throwaway probe `probe-guardlag.ts` backs the bug-fix claim below — it's not a
gate; bundle+run it with esbuild like `balance`/`determinism`.)

## Current `pnpm balance` output (advisory — all metrics non-asserting per Q27)

```
=== OPEN shot make% (no defender) ===
  layup 72  |  midrange 52  |  corner-3 43  |  top-3 40

=== Self-play over 60 games (both sides CPU) ===
  shots=1595  FG%=39
  shot mix:  layup 8%  |  two 89%  |  three 3%
  3PA share=3%  3P%=23
  per game:  steals 5.2  blocks 3.9  shot-clock TOs 0.0
  pace:  318.3 steps/game,  30.6 possessions,  0.7 pts/possession
  stamina at game end:  avg 90.1  min 9.7

=== Does player defense matter? (AI offense, same 60 seeds) ===
  player GUARDS:  AI pts=359 over 824 poss → 0.4 pts/poss  (FG% 30)
  player IDLE:    AI pts=960 over 1686 poss → 0.6 pts/poss  (FG% 40)
  => defense effect: 23.5% fewer AI pts/possession when guarding
```

Reading it: the harness runs and pace migrated beats→steps (Q27). The numbers are
skewed by the **placeholder AI**, not the engine: ~10 steps/possession (it settles
for a pull-up almost immediately rather than committing a long drive), an 89%-two
shot mix, and low PPP all trace to a greedy per-step AI that never holds a drive.
Defense still measurably matters (+23.5% per-possession). These will move a lot
once the committed-intent AI (Q25) actually drives — left for tuning sessions; do
not read them as engine balance.

## Does the step model fix guard-lag + phantom-through?

**Yes — verified on the doc's own guard-lag seed, `-755680012`.** The doc's "Why
this rework" cites the bug: under the single-shot beat the on-ball defender aimed
at the handler's start-of-beat spot and resolved before he moved, so a burst drive
covered ~35.6 units while the defender moved ~3.3 — **gap 23.3 after one beat**.

`probe-guardlag.ts` drives `player-0` at the rim vs his guard `ai-0` on that seed,
printing the handler↔guard gap each step:

```
step |  gap  | hMoved | gMoved | hSprint | h→rim
   1 |   9.0 |   4.40 |   4.40 |    9.51 |  62.6
   2 |   9.0 |   4.40 |   4.40 |   10.68 |  58.2
   3 |   6.6 |  11.34 |   8.90 |   11.34 |  46.9
   4 |   4.4 |  11.56 |   9.42 |   11.56 |  35.3
   5 |   3.2 |  11.46 |  10.28 |   11.46 |  23.8
   6 |   5.8 |   9.87 |  12.41 |   10.99 |  14.0
   7 |   9.1 |   0.14 |   3.23 |   10.52 |  14.1
cumulative over the drive: handler moved 53.2, guard moved 53.0
```

- **Guard-lag is gone.** Across the whole ~53-unit drive the gap stays bounded in
  **[3.2, 9.1]** and the two move in near-lockstep (53.2 vs 53.0). The old 23-unit
  blowout never happens — continuous per-step resolution re-closes the defender
  against the handler's incremental position every step, so the gap is governed by
  the guard's 9-unit goal-side cushion, not a full-beat leap.
- **Momentum still reads correctly (Q4/Q22).** Steps 1–2 the **set** defender
  (intended-move ≈ 0 ⇒ full anchor) *stuffs* the drive — the handler only inches
  4.4 while his `sprintSpeed` ramps 9.5→10.7. By step 3 the built-up momentum
  (`sprintSpeed` 11.3) exceeds the anchor and he **bulls through** (11+ per step).
  Long runway = heavy drive, exactly the design.
- **Phantom-through is gone.** The handler never lands goal-side of the guard
  without contact resolving (the probe's "slipped goalside" check never fires);
  the body is either bulled (shoved along the drive normal, capped) or the drive
  is stopped just shy — never a clean leap through.

So the foundational claim holds: splitting momentum (commit a line) from staying
attached (resolve step-by-step) dissolves both bugs, while the bull contest still
rewards a committed runway.

## STOP — awaiting core-feel evaluation

Core engine is green and committed. Per the brief I stopped here: no AI, actions,
or UI. Next sessions build on this contract (committed-intent AI Q25, gather-shot
Q17, ball-as-object passing Q18, screens Q19, the tap-per-step UI Q14/Q15, and
balance recalibration).
