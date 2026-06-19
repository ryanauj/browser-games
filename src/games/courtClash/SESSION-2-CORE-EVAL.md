# Court Clash Movement Rework — Core-Engine Evaluation (Session 2)

Skeptical review of the Session 1 core step engine: is the FOUNDATION sound
enough to fan out AI (Q25), actions (Q17–Q20), and UI (Q14/Q15) on top of it
WITHOUT schema churn? This is an evaluation, not a feature session. Source of
truth: `MOVEMENT-REWORK.md` (Q1–Q29).

## Verdict: **GO** (schema is frozen-ready)

The foundation is sound. Determinism gate is green and reproducible, both
target bugs are dead, the schema covers every verb the later sessions need, and
`pnpm balance` produces a live, plausible (placeholder-skewed) game. AI/actions/
UI can build against the schema as-is.

Two follow-ups, **neither blocking fan-out**: one doc correction (cheap, do now)
and one engine fix required before the Q25 simultaneous AI (not before the other
sessions).

---

## 1. Determinism gate — GREEN, reproduced twice ✅

Ran `pnpm determinism` twice; **byte-identical** both times, identical action
counts per seed:

```
✓ all 10 seeds: self-play, replay & scripted all byte-identical
DETERMINISM GATE: GREEN — 10 seeds replay byte-identical.
```

The harness is genuinely strong — it stringifies the **whole** `GameState`
(incl. `sprintSpeed`/`sprintDir`/`rngState`) after **every** action, across three
checks: self-play×2, record-and-replay into a fresh reducer, and a scripted human
game with mid-sprint bails (`determinism.ts:91`) that stresses redirect/accel.
`tsc --noEmit` clean. All randomness threaded through serialized `rngState` via
`Roll`/`nextRandom`; no `Date.now`/`Math.random`/unstable-iteration leaks found.

## 2. `pnpm balance` — alive and plausible ✅ (advisory per Q27)

```
OPEN shot make%:  layup 72 | mid 52 | corner-3 43 | top-3 40
Self-play 60 games:  shots=1595  FG%=39   mix: layup 8% / two 89% / three 3%
  steals 5.2  blocks 3.9  shot-clock TOs 0.0
  pace: 318.3 steps/game, 30.6 possessions, 0.7 pts/poss   stamina end avg 90.1 / min 9.7
Defense matters:  guarding = 23.5% fewer AI pts/poss (FG% 30 vs 40)
```

60 games complete; no NaN, no 0-possession, no degenerate stalls. Defense
measurably matters. The 89%-twos / ~10-step possessions are the **placeholder
greedy AI** (never holds a drive), not the engine — correctly disclaimed in the
notes. As "alive and plausible," it passes.

## 3. The two bugs — both killed ✅

**Guard-lag** (seed `-755680012`, via `probe-guardlag.ts`):

```
step | gap | hMoved | gMoved | hSprint | h→rim
  1  | 9.0 |  4.40  |  4.40  |  9.51   | 62.6   ← set defender stuffs (handler inches)
  3  | 6.6 | 11.34  |  8.90  | 11.34   | 46.9   ← momentum built, handler bulls & gains
  5  | 3.2 | 11.46  | 10.28  | 11.46   | 23.8   ← gap closed 9.0→3.2 on the jogging guard
cumulative: handler 53.2, guard 53.0
```

Gap stays bounded in **[3.2, 9.1]** across the whole 53-unit drive — the old
23-unit single-beat blowout never opens. Momentum still reads correctly: a *set*
defender stuffs the first two steps, then built-up `sprintSpeed` (Q22 pre-contact
term) bulls through. Also shows the sprinter **gaining ground on a jogging
defender** (gap 9.0→3.2) — the design's separation property.

**Phantom-through** — gone by construction: `driveCollision` either stops the
driver `hitT - 0.1` shy of the body (`engine.ts:384`) or bulls and shoves the
defender along the normal; never a clean leap through. The probe's "slipped
goalside" assertion never fires.

> **Evidence gap (not a defect):** the complementary case — *a defender who
> commits a sprint route stays attached* — is **structurally supported** (the
> sprint machinery in `applyMovement` is mode-agnostic; any player can sprint)
> but **not exercised**, because the placeholder guard only jogs. No defensive-
> sprint AI exists until Q25. Untested behaviorally; the engine path exists.

## 4. Schema review — clean and stable for fan-out ✅

`Order` / `Player` / `GameState` (`types.ts`) are in good shape:

- `Order` already defines **every** verb the later sessions need
  (`drive`/`cut`/`screen`/`pass`/`guard`/`double`/`help`/`steal`) even though
  only movement is wired — the actions session fills *behavior*, not *schema*.
- `MoveMode` + `move.mode`, and per-player `sprintSpeed`/`sprintDir`, are
  serialized and replay-exact (`Player:64-71`).
- `GameState` has `step`/`shotClock`/`seed`/`rngState` — everything the reducer
  is a pure function of.

**Two forward-looking schema notes** (additive, not churn — safe to fan out, but
tell the next sessions):

- **Traveling-ball hook is NOT stubbed.** Q18 ("ball travels as an object") will
  add a ball entity to `GameState` and allow `ballHandlerId: null` during flight.
  UI/AI built now must **not** assume `ballHandlerId` is always non-null while
  `phase==='play'`. Additive extension, not a rewrite — but bake the nullable-
  handler assumption in now.
- `BeatEvent.kind` models `pass`/`steal` as one-shot events; ball-as-object turns
  those multi-step. Trivially additive.

No schema *defect* blocks fan-out.

## 5. Fidelity to decisions — matches, with one overclaim to correct

Spot-checked against `[CHOSEN]`:

- **Q5** angle×speed redirect — ✅ `engine.ts:459-465` (`angleBetween` ×
  `sprintSpeed/top`, resets ramp, taxes stamina).
- **Q12** target-then-hold — ✅ `ARRIVE_EPS` hold, ramp resets on arrival
  (`engine.ts:451-454`).
- **Q22** pre-contact speed coupling — ✅ `driveCollision` reads
  `driver.sprintSpeed` as momentum (`engine.ts:378`).
- **Q26** per-step stamina by mode + redirect tax + recover-when-slow — ✅
  `engine.ts:509-514`.
- **Q28/Q29** recorded correctly in the doc.

> **⚠️ Q16 "order-independent" is overclaimed.** SESSION-1-NOTES says "resolution
> is order-independent." It is **deterministic** (fixed array order → green gate)
> but **not order-independent**:
>
> - Roster is fixed `[player-0..4, ai-0..4]` (`roster.ts:67`). `applyMovement`
>   iterates in that order and `driveCollision` **unconditionally overwrites** a
>   bulled defender's position to `defStart + shove` (`engine.ts:393-394`). So a
>   bulled defender's *own jog* is **compounded** when the player is on offense
>   (driver iterated first → defender jogs after, off the shoved spot) but
>   **discarded** when the AI is on offense (defender jogs first → bull overwrites
>   it). Same inputs, different result depending on which side holds the ball — a
>   structural home-side asymmetry. (A bull fires in normal play; probe steps 3–6.)
> - Off-ball `contestedStep` (`engine.ts:502`) reads **live** opponent positions,
>   not start-of-step, so a later-iterated mover sees already-moved bodies.

## Why this is GO, not FIX-FIRST

The order-independence gap is internal to collision *resolution*, not the
*schema*. AI/actions/UI build against the schema and are unaffected; it does
**not** block fan-out. But it **must** be fixed before the **Q25 simultaneous-
rollout AI** trusts order-independence (a fair simultaneous AI can't sit on a
home-side resolution bias), and the actions session reworks this collision path
anyway (Q28). Proper fix: a two-phase `applyMovement` (compute all intended
next-positions from `before`, then resolve contacts against that buffer) — not
tiny, so it was **not** applied during evaluation. Determinism gate left GREEN.

---

## Frozen contract for the next sessions

Build against these as stable; the only sanctioned additions are marked.

| Type | Status |
|---|---|
| `Order` union (all 10 verbs) | **Frozen.** Actions session fills behavior, not shape. |
| `MoveMode`, `move.mode` | **Frozen.** drive/cut are implicit sprint (Q28). |
| `Player.{sprintSpeed, sprintDir, stuck, screenHeld, primed, bull}` | **Frozen**, serialized, replay-exact. |
| `GameState.{step, shotClock, seed, rngState, offense, ballHandlerId}` | **Frozen** — except ↓ |
| `ballHandlerId` nullability | **Will gain `null`-during-flight** in Q18. Don't assume non-null now. |
| New ball entity on `GameState` | **Additive in Q18** (traveling-ball). |
| Determinism gate | **Always-on.** Re-run after every change; red = blocker. |

## Action items (per future session)

1. **Doc correction (cheap, do now / any session):** change SESSION-1-NOTES'
   "resolution is order-independent" to "deterministic via fixed iteration order;
   true order-independence is a Q25 prerequisite, tracked." Optionally add a Q to
   `MOVEMENT-REWORK.md`.
2. **Engine — before the Q25 AI session (not before actions/UI scaffolding):**
   make `applyMovement` two-phase so bull-shove and `contestedStep` don't depend
   on array position / ball-side. Re-run the determinism gate after.

## Guidance for the per-session prompt generator

- **Actions session (Q17–Q20):** schema is ready; you mostly fill behavior into
  existing `Order` verbs. Q18 is the one place you extend `GameState` (ball
  entity + nullable `ballHandlerId`) — do it additively. Re-run `pnpm
  determinism` after every change; it is the only hard gate.
- **AI session (Q25):** you depend on order-independent resolution. **Do action
  item #2 first** (two-phase `applyMovement`), then build the committed-intent /
  predictive-rollout planner. The placeholder `aiPlan` in `ai.ts` is the OLD
  greedy floor general — replace it; do not extend it. The AI must decide from
  revealed (last-step) state only and never read the opponent's order committed
  this step.
- **UI session (Q14/Q15):** show own orders only (telegraph), infer opponent from
  motion. Treat `ballHandlerId === null` as a valid in-play state (ball in
  flight). Render speed/trails legibly so the read game works.
- **All sessions:** balance metrics are advisory (Q27) — judge "alive and
  plausible," not feel targets, until a config feels good and metrics get promoted
  to hard gates.
