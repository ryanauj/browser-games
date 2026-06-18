# Court Clash — Movement Rework Design Notes

> A living scratchpad for the **sub-step movement / momentum** rework. Captures
> every design decision we've made, the alternatives we considered, and the
> tradeoffs — so we can revisit, swap variations, and combine pieces later.
> Nothing here is built yet; this is the spec we're shaping before code.

## Why this rework

Two bugs in the current single-shot beat model exposed a deeper design gap:

1. **Guard-lag bug** — a `guard` defender aims 9 units goal-side of the ball
   handler's *start-of-beat* position and is resolved before the handler moves.
   A burst drive then covers ~35 units past it in one beat, so the defender
   chases last beat's spot and falls a full step behind *every* beat. Verified
   by replay (seed -755680012): defender on `guard→ai-0` moved 3.3 units while
   ai-0 drove 35.6 — gap 23.3 after one beat, despite full reach (25.2).
2. **Phantom-through (historic "ghost")** — end-of-beat-only overlap checks let a
   burst step leap clean through bodies; patched with `contestedStep` (slow) +
   `driveCollision` (bull/stop), but those only fire when a body is actually in
   the path — and because of bug #1 the on-ball man usually isn't.

The unifying insight from the discussion: **momentum (bull power) and "staying
with your man" feel contradictory only because the single-shot beat forces them
onto the same axis.** Sub-stepping splits them: momentum comes from *committing*
to a line; staying attached comes from *reacting* step-by-step. The cost that
separates the two is what we're tuning.

## Core architecture (proposed) — SYNTHESIZED MODEL

Movement is **pure step-by-step** (micro-steps). Each step you may steer any
player. **Speed is gated behind commitment:**

- **Jog (default).** Steer step-by-step with no committed plan → flat **jog**
  speed, fully reactive, cheap to change heading each step (slow = nimble).
- **Sprint (committed).** Lay a **multi-step plan ahead** (a route). While
  following it you **accelerate per step** along the committed line — the
  acceleration ramp (Q4), how fast it builds set by an accel/agility attribute.
  Speed above a jog — and the **momentum that powers a bull-through** — exists
  *only* because you committed ahead.
- **Bail vs continue.** Deviate from a committed sprint and pay the **angle×speed
  redirect penalty** (Q5) — costly precisely because you're moving fast; or stay
  on the line and keep building speed.

Net dial, per player, every moment: **fast + heavy + telegraphed** (committed
sprint) vs **slow + nimble + reactive** (jog). Offense and defense both choose.
Each step also resolves collisions/separation continuously, so the guard-lag and
phantom-through bugs both dissolve (no full-beat jump to lag behind or tunnel
through).

Defensive consequence (to design out): a jogging defender stays with a jogging
handler, but a *committed sprinting* handler outruns a jogging defender — so to
keep up the defender must ALSO commit a sprint route (becoming telegraphed
himself), or anticipate and cut off the line. Staying attached is a skill +
commitment choice, never automatic.

Hard constraint (unchanged): the reducer stays **pure + deterministic** — routes
and per-step steers are just orders; sub-steps must replay exactly.

---

## Decisions log

Format: **Question → [CHOSEN]** then the alternatives with tradeoffs, so any row
can be swapped/combined in a future variation.

### Q1 — What decides a drive collision (bull-through vs stopped)? *(existing, shipped)*
**[CHOSEN: strength + momentum vs the defender's anchor; a SET (barely-moving) defender anchors harder]**
- Random RNG roll — rejected: non-deterministic feel, no skill expression.
- More stamina wins — rejected: stamina is a separate resource, not the contest.
- Shot-clock pressure — rejected: unrelated to physics.
- *Note:* this is the current `driveCollision` model and the rework should keep
  it, feeding it the new continuous momentum (see Q4/Q5).

### Q2 — Commitment penalty: cost of chaining steps ahead vs reacting each step?
**[CHOSEN: redirect costs speed + stamina]**
- Locked heading (telegraph) — committed sprint can't change direction mid-chain;
  readable, but feels rigid / removes agency.
- Momentum-vs-agility dial — each committed step adds bull power but subtracts
  reaction; clean but abstract.
- **Redirect costs speed/stamina** *(chosen)* — you CAN bail a planned sprint,
  but decel + re-accel costs ground and stamina. Straight committed drives are
  fastest; constant reactors are flexible but slower and tire. Emergent payoff:
  a mirroring defender pays a continuous redirect tax → tires → surrenders a step
  on long drives; a hesitating driver sheds momentum → gets stopped. "Downhill
  vs east-west" falls out for free.
- Overrun/whiff — plan past live info and overrun the spot; punishes
  planning-too-far. (Could still layer in as a mild extra effect.)

### Q3 — How does the player drive the chaining (where do planned sprints live)?
**[CHOSEN: plan a multi-beat route (draw a path)]**
- Engine-internal only — one order + Next Beat, sub-steps under the hood;
  smallest UX, fixes the bugs, keeps current feel. (Good fallback if the route
  UI proves too heavy.)
- **Plan a multi-beat route** *(chosen)* — queue a chained sprint across beats
  (draw a path). Committing far ahead banks momentum but eats the redirect cost
  if the play changes and you bail. Most faithful to "chain steps / plan ahead";
  biggest UX (new path-drawing UI for both sides) and an AI route-planner.
- Sprint toggle (hybrid) — one order/beat + a "commit" toggle holding heading
  across beats. Middle ground; keep as a possible simplification.

### Q4 — Speed/momentum behavior along a committed route?
**[CHOSEN: acceleration ramp, modulated by an acceleration/agility attribute]**
- **Acceleration ramp** *(chosen)* — start slow, accelerate over committed
  straight steps toward a top speed; redirecting decelerates. Long runway = fast,
  heavy drive (high bull power); standing/cutting player is slow. Bull power =
  current speed. **Twist:** how fast the ramp builds is driven by a new
  `acceleration` (or reuse/extend `agility`/`speed`) attribute — quick-twitch
  players reach top speed sooner; bigs lumber up.
- Wind-up to burst (two-tier) — jog default, 1-step wind-up unlocks burst held
  while heading holds; simpler discretization of the same idea.
- Flat speed, momentum = bull only — smallest change; momentum affects only
  contact, not travel speed. (Fallback if continuous accel destabilizes pace.)

### Q5 — How steep is the redirect cost — what does it scale with?
**[CHOSEN: both — angle × speed]**
- Scales with turn angle — gentle curve ~free, sharp cut sheds lots; physical,
  pairs with accel ramp.
- Scales with current speed — faster = harder to turn (freight train); standing
  players redirect freely.
- **Both (angle × speed)** *(chosen)* — cost = how hard you turn × how fast
  you're going. Slow nudge free; fast hard cut brutal. A full-speed driver is
  truly committed/telegraphed; change-of-direction taxes the trailing reactor
  most (a crossover at speed forces the chaser to pay to match). Two knobs
  (angle coeff, speed coeff) → richest but easiest to make swingy; tune carefully.
- Flat per redirect — simplest; no nuance between a nudge and a reverse pivot.

---

### Q6 — What does "reacting" mean for a defender? *(reframed during discussion)*
**[DIRECTION: defense is active anticipation by the controller, not automatic glue]**
- The earlier framing (auto-mirror with a stickiness cap: stat-gated / sub-step
  lag / turn-rate cap / perfect mirror) is **set aside**. Instead: there is no
  automatic "stay glued to your man." The controller (human or AI) *reads* which
  way an offensive player is committed and **steers the defender to cut him off**,
  re-correcting as the play develops. The redirect cost (Q5, angle×speed) applies
  to the defender's path too, so guessing wrong (over-committing the wrong way)
  costs speed/stamina to recover. Offense commits a line; defense reads & counters
  — symmetric. Open sub-question: does a convenience auto-`guard` still exist as a
  default you can override? (see cadence decision Q7.)

### Q7 — Steering cadence / does auto-follow remain?
**[CHOSEN: per micro-step — you can re-aim at each sub-step]**
- Per beat, manual, no auto-glue — symmetric, ~5 inputs/side per beat.
- Per beat, auto-guard + override — least busywork; anticipation opt-in.
- **Per micro-step** *(chosen)* — finest anticipation/counter-moves; you can
  re-aim mid-beat at each sub-step. **Tension to resolve:** this pulls against
  Q3 (commit a multi-beat route ahead) and risks heavy input (5 players ×
  several sub-steps). Likely reconciliation: routes are the committed *default
  / auto-pilot* (momentum builds along them), and the per-micro-step pause is an
  *optional interrupt* to re-steer (paying the Q5 redirect cost) — you intervene
  to anticipate/counter, not every step. See Q8.

### Q8 — How do multi-beat routes and per-step steering coexist?
**[CHOSEN: pure step-by-step; routes are the SPRINT mechanism, not the default]**
- Route = autopilot + optional interrupt — set routes, autopilot executes,
  intervene optionally. (Superseded.)
- Mandatory step-by-step confirm — too much input.
- **Pure step-by-step, commit-to-sprint** *(chosen, refined)* — execution is
  always step-by-step. You move at a flat **jog** unless you **plan ahead a
  multi-step route**, which is how you *sprint*: accelerate along the committed
  line, picking up speed per step. You can **bail** (redirect penalty) or
  **continue** (keep building speed). Reconciles Q3 (routes) + Q7 (per-step):
  routes aren't an autopilot you set and forget — they're the *act of committing
  to a sprint*; everything else is reactive jogging. This **revises Q3**: routes
  are the sprint-commitment tool, not the baseline interaction.

### Q9 — How does a defender stay with a committed (faster-than-jog) sprinter?
**[CHOSEN: anticipate + cut off the spot, AND positional/contact leverage — combined]**
- **Cut off the spot, don't chase** — can't out-run a sprint from behind; commit
  a sprint to a spot AHEAD to beat him to the lane, forcing a stop/bail. Rewards
  reading the line over foot speed; trailing is a lost cause by design.
- **Positional gap = leverage** — a goal-side defender doesn't match speed; the
  sprinter runs INTO him → the bull/stop contact contest, which favors the set,
  well-positioned body.
- *(both chosen, they reinforce)* Defense = positioning + anticipation, never a
  stern chase. You read the committed line, beat him to the spot / hold the right
  side, and let contact resolve it. Trailing a sprint can't recover. Makes the
  **rim protector** (set, goal-side, holding the spot) the purest expression of
  this — i.e., the existing drop/plant model, now with a first-principles reason.
  Open sub-thread: exact contact resolution when a sprinter meets a set defender
  who cut off the spot (reuse `driveCollision` fed by sprint momentum).

### Q10 — Step granularity / does the "beat" survive?
**[CHOSEN: fully step-based — no beat]**
- Beat = ~3-4 steps (light) — keep beat as clock/cadence, sub-resolve; lowest
  disruption.
- Beat = ~6-8 steps (fine) — beat still groups the clock; richer cat-and-mouse.
- **Fully step-based (no beat)** *(chosen)* — drop the beat entirely; the **step**
  is the atomic unit and the **shot clock counts steps**. Most faithful to
  step-by-step. Biggest restructure: clock, pace targets, AI planner, the
  `balance.ts` harness, and the UI all move to steps. Forces decisions on step
  size, steps-per-possession, default-between-inputs, and (critically) the
  time-advance / pacing model (Q11).

### Q11 — Time-advance / input model (fully step-based)?
**[CHOSEN: turn-based, tap per step]**
- **Turn-based, tap per step** *(chosen)* — each step: review, optionally
  re-steer, tap to advance one step. Keeps the deliberate/chess identity at fine
  resolution. Cost: a possession is many taps (~40-60), so default-between-taps
  behavior (Q12) is critical, and the UI must make "advance with current orders"
  one tap. Players continue their orders between taps.
- Auto-advance + pause-on-demand — fewer taps, live flow; set aside.
- Real-time continuous — genre shift to action game; rejected.
- Commit-then-watch (event-driven stops) — coarser human cadence; set aside (a
  possible later convenience layer over the tap-per-step core).

### Q12 — Default behavior on a step where a player gets no new input?
**[CHOSEN: continue to target, then hold]**
- Continue current heading — keep a direction forever; set aside (chosen instead
  the target model, see below).
- **Continue to target, then hold** *(chosen)* — a player moves toward his last
  set TARGET each step and stops on arrival. Rationale: it makes sprint-vs-jog
  natural — *commitment = how far ahead you point the target*. A short/near
  target (re-set often) = reactive **jog**; a far committed target left untouched
  = **sprint** that accelerates over the committed distance. Arrival = a natural
  decel/stop. "Bail" = re-target before arrival (redirect cost + accel reset);
  "continue" = leave the far target and keep building speed toward it.
- Hold unless ordered — too much input.
- *Implementation thread (open, Q13):* exactly how acceleration/sprint is derived
  from the target — implicit (committed uninterrupted distance) vs explicit mode
  vs distance threshold.

### Q13 — How is sprint vs jog determined (target-then-hold)?
**[CHOSEN: explicit jog/sprint toggle on the order]**
- Implicit by committed distance — no toggle; uninterrupted travel accelerates;
  set aside.
- **Explicit jog/sprint toggle** *(chosen)* — every movement order carries a
  `mode: 'jog' | 'sprint'` + target. JOG = flat jog speed, cheap to re-aim, fully
  reactive, no momentum. SPRINT = accelerates toward the target (Q4 ramp),
  redirect penalty to change (Q5 angle×speed), and is **telegraphed** (opponent
  sees the committed sprint line → the anticipation/read game). Schema: extend the
  move/drive order with `mode`, accumulate momentum only while sprinting toward an
  unchanged target; bull power = current sprint speed.
- Distance threshold — coarse; set aside.

---

## Model snapshot (after Q1–Q13)

Pure **step-based**, **tap-per-step**, turn-based. Each order = **target + jog|
sprint**. **Jog**: flat, cheap to re-aim, reactive, no momentum. **Sprint**:
commit a target, **accelerate** along the line (ramp speed set by an accel/agility
attr), **telegraphed**, and pay an **angle×speed** penalty to bail. Default
between taps: **move to target, then hold**. Contact uses the existing
**bull-vs-stop** contest fed by current sprint momentum; a SET, goal-side
defender anchors. **Defense = anticipate the committed line, beat him to the spot
/ hold goal-side**, never chase a sprint from behind. Continuous per-step
resolution kills the guard-lag and phantom-through bugs.

## UI / interaction decisions

### Q14 — How do you issue one move order (target + jog/sprint)?
**[CHOSEN: select + explicit toggle]**
- Tap = jog, drag = sprint (gesture-implicit) — fastest/tactile; set aside.
- **Select + explicit toggle** *(chosen)* — tap player → tap target spot → tap a
  Jog/Sprint toggle to confirm. Deliberate, unambiguous, precise retargeting;
  one extra tap per order (fine given precision matters when repeated all
  possession). Sprint orders draw the committed line (telegraph, Q15).
- Sticky per-player stance — fewest decisions but easy to mismatch; set aside.

## Open decisions (not yet made)
- **Momentum → bull coupling** — does `driveCollision` read current speed
  directly as the momentum term (replacing `COLLIDE_DRIVE_MOMENTUM × stepLen`)?
- **Acceleration attribute** — new attr vs derive from existing `speed`/a new
  `agility`. Affects roster, UI badges, balance.
- **Replan / interrupt model** — re-plan any beat (cost on bail) vs commit
  windows vs free re-plan (momentum just resets).
- **Defender reaction cap** — can a reactor perfectly mirror, or only within a
  reaction radius / speed? Prevents over-sticky D (the risk that re-attaching
  defenders smother drives and push the offense back to heaves).
- **AI route planner** — how the CPU plans/adjusts routes for 5 men each side,
  staying pure & cheap.
- **Stamina economy** — recalibrate costs for continuous reaction taxes so games
  don't gas everyone (watch `pnpm balance` stamina line).
- **Validation gates** — keep the guardrails: shot mix (rim finishes alive),
  defense-matters %, steals ~4, pace ~30 poss, deterministic replays.

## Variation ideas to try later (compare/combine)

- Accel ramp (Q4) **+** engine-internal chaining (Q3 alt) as a low-risk first
  cut before building the route UI.
- Locked-heading (Q2 alt) **+** acceleration ramp — more telegraphed, more
  readable defense; compare feel vs the redirect-cost version.
- Flat-speed + momentum-as-bull-only (Q4 alt) as the *minimal* fix to the
  guard-lag bug (two-phase tracking) without changing travel speed — useful A/B
  baseline to isolate how much the accel ramp actually changes balance.
