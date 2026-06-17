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

## Core architecture (proposed)

Resolve each beat as **several micro-steps** instead of one ~25-unit jump. Per
micro-step: advance everyone a fraction toward their target, resolve
collisions/separation, and **re-aim tracking movers (guard/double/steal) at the
updated positions**. This dissolves both bugs (defenders track continuously;
nothing tunnels). Players **chain** micro-steps into planned sprints that bank
**momentum**; committing ahead trades off against reacting.

Hard constraint (unchanged): the reducer stays **pure + deterministic** — routes
are just orders; sub-steps must replay exactly.

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

---

## Open decisions (not yet made)

- **Micro-step granularity** — how many sub-steps per beat (2 / 4 / 8…)? More =
  smoother tracking + truer collisions, more compute. Likely engine-internal;
  UI may still animate beat→beat or interpolate sub-steps.
- **Redirect-cost scaling** — flat, or proportional to turn angle (gentle curve
  cheap, hard cut expensive) and/or current speed? Angle-proportional pairs
  naturally with the accel ramp.
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
