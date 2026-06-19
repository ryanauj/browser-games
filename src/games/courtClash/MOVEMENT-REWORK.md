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

### Q15 — How much intent is visible (telegraph)?
**[CHOSEN: own orders only — infer the opponent from on-floor motion]**
- Full: sprint lines shown to both — set aside.
- Partial: direction only — set aside.
- **Own orders only** *(chosen)* — you see only your own targets/modes; you read
  the opponent purely from observable motion (a sprinter visibly accelerates /
  moves faster / leaves a trail). No explicit opponent lines. Highest bluff
  potential; reading is pure skill.
- **Revises Q13:** a sprint's "telegraph" is now *implicit motion*, not a drawn
  line. The strategic intent survives (sprints are committed + readable) but the
  readout is the player's visible speed/acceleration. **Hard UI requirement:**
  speed/acceleration must be unmistakably legible (faster per-step travel, motion
  trails, lean) or reading is unfair. Nice property: reading speed = reading
  commitment (faster ⇒ higher angle×speed bail cost ⇒ more committed).

### Q16 — How does a step resolve between you and the AI?
**[CHOSEN: simultaneous — both commit hidden, resolve together]**
- **Simultaneous** *(chosen)* — each step both sides commit orders hidden, then
  both resolve at once. Built-in 1-step read lag ⇒ anticipation is structural
  (predict, don't counter in-step). Fits "infer from motion"; symmetric, tense.
  *Engine note:* resolution must be order-independent with a deterministic
  tie-break when both teams contest a spot, so replays stay exact. The AI must
  decide from the revealed (last-step) state only — no peeking at your committed
  order.
- Alternating (IGOUGO) — simpler but asymmetric info edge; set aside.

## Interaction loop (after Q14–Q16)

Each step: (1) you adjust orders for any subset of players — tap player, tap
target, toggle jog/sprint; untouched players continue to their target then hold;
(2) the AI commits its step hidden from the revealed state; (3) both resolve
simultaneously (continuous collision/separation, deterministic tie-break); (4)
you watch the revealed motion (speed/trails legible) and react next step. You see
only your own orders; you read the opponent from motion.

## Actions in the step model

### Q17 — How does a shot work?
**[CHOSEN: multi-step gather + release]**
- **Multi-step gather + release** *(chosen)* — a shot order starts a gather (a
  few steps; length maybe modified by a quick-release/shooting attr); shooter is
  rooted/slow during it. A defender who READS it and closes into his face before
  release drops quality; hard contact can disrupt (or foul). Sprinting straight
  into a shot = a rushed runner (lower quality) — a clean pull-up needs to set
  first (decel, giving the D a step). Contests become timing + positional, fully
  in the read game. Cascades to design: gather length & quality curve, rebounds
  as a **loose-ball positional contest** on a miss, and foul-on-contact rules.
- Instant shot — simpler, no closeout drama; set aside.
- Set-gated instant — hybrid; set aside.

### Q18 — How does passing work (and therefore steals)?
**[CHOSEN: ball travels over steps as an object]**
- **Ball travels over steps** *(chosen)* — a pass launches the ball as an entity
  with position + velocity, moving a set distance/step toward its target (speed by
  pass type / passer attr). A defender whose body intersects the lane mid-flight
  intercepts/deflects → steals are **positional + anticipatory** (read the lane,
  step into it), and **lead passes** (throw to a spot a cutter is sprinting to)
  work naturally. Unifies ball-in-flight + deflections + missed catches +
  rebounds into ONE concept: a loose/traveling ball resolved by positional
  contest. Adds a traveling-ball entity to state (deterministic).
- Instant, lane-at-release — simpler, no true reads/leads; set aside.

### Q19 — Are screens a special action or emergent?
**[CHOSEN: explicit screen order]**
- **Explicit screen order** *(chosen)* — a screen is an order that, on contact,
  briefly holds/stops the defender (a short impede), with a clear "screen set"
  state the player can read. More legible and controllable than relying on the
  generic collision. Cost: adds a rule plus **moving-screen / illegal-screen
  foul** logic (screener must be set/planted; moving into the defender = foul).
- Emergent-from-positioning — fewest rules but less legible; set aside.

### Q20 — How do on-ball steals work?
**[CHOSEN: purely positional for now; active strip deferred]**
- **Purely positional** *(chosen for now)* — the only ways to take the ball:
  intercept/deflect a pass in its lane (Q18), or force a loose ball via the
  contact contest when the handler is bumped off balance. No new verb, lowest
  foul-logic burden; strips are a consequence of good defense, not a button.
- **Active strip attempt** — *deferred*: add later IF it proves necessary. An
  in-range reach-in order: chance to knock the ball loose (scaled by attrs /
  handle exposure), risking a reach-in foul on a miss. Revisit after the
  positional model is playing.

## Tuning / model decisions (resolved from the open list)

### Q21 — Defender reaction cap (how tightly can a reacting jog defender mirror)?
**[CHOSEN: structural caps only for now — defer an explicit cap; revisit after playtesting]**
- From-behind sprints are already capped structurally: a reactor can't exceed
  **jog speed** (so a built-up sprint separates, Q9) and **simultaneous resolution
  gives a built-in 1-step read lag** (Q16). The only *unaddressed* case is
  **jog-vs-jog half-court**, where a reactor re-aiming every micro-step could
  mirror almost perfectly (1-step lag only) and smother the gather-room a quality
  look needs → risk of pushing offense back to heaves.
- **Structural-only (chosen, for now)** — rely on the jog ceiling + 1-step lag
  alone; no new knob. Rationale: we're *assuming* the half-court smother is a
  problem without evidence. Don't add a knob to fix an unobserved failure. **Flag
  to revisit after playtesting** — if reactive D proves over-sticky in the
  half-court, adopt the slide-speed cap below.
- **Slide-speed cap** *(documented fallback)* — a defender who is *reacting*
  (re-aiming off the revealed state) moves at a reduced react/slide speed, esp.
  laterally, so the side that commits a straight line first wins a sliver of
  ground each step (commitment stays readable/telegraphed). One knob (slide
  factor); basketball-true ("you slide slower than you run"); composes with the
  Q5 angle×speed redirect cost (which only bites at speed — this fills the
  jog-regime gap). Makes the offensive counter explicit: commit + change
  direction to break a mirror. **This is the first thing to try if playtest shows
  over-sticky D.**
- **Stat-gated mirror** — cap scales with `perimeterD`/`speed`; elite D sticky,
  weak D lags. Most roster expression, most knobs, biggest balance risk. Can
  layer *on top* of the slide-speed cap later (let `perimeterD` modulate the
  slide factor) without re-opening the core.
- **Reaction-radius gate** — defender only glues/contests within a reaction
  radius; coarse, and reintroduces the soft auto-glue Q6 deliberately dropped.
  Set aside.

### Q22 — Momentum → bull coupling (how `driveCollision` gets the momentum term)?
**[CHOSEN: read the current (pre-contact) sprint speed directly]**
- Q4 already declared **bull power = current speed**; this implements it. Today
  `driveCollision` (`engine.ts:340`) uses
  `shoveMass(driver) + COLLIDE_DRIVE_MOMENTUM × len` (beat step length).
- **Read current speed directly (chosen)** — momentum term = `k × currentSpeed`,
  taken from the player's tracked sprint speed **before** the collision clips the
  step. One source of truth: the Q4 accel ramp flows straight into contact (long
  runway ⇒ heavy hit, standing/cutting man ⇒ light). Using the **pre-contact**
  speed fixes a latent underread — a blocked freight-train drive has its step
  *shortened* by the collision, so a post-clip `len` would read momentum *lowest*
  exactly when it should read highest. Needs speed as tracked per-player state
  (the accel model needs it anyway); retune `k` (replaces `COLLIDE_DRIVE_MOMENTUM`).
- **Keep the `stepLen` proxy** — `COLLIDE_DRIVE_MOMENTUM × stepLen`; ≈ speed in a
  step model and needs no new dependency, but inherits the post-clip underread
  unless carefully fed the *intended* pre-collision length (then it's just a
  clunkier proxy for speed). Set aside.
- **Decouple: bull power from committed straight-step count, not instantaneous
  speed** — abstract, and contradicts Q4. Set aside.

### Q23 — Acceleration attribute (where the Q4 ramp rate comes from)?
**[CHOSEN: derive accel from existing `speed`; new `acceleration` attr is the explicit upgrade path]**
- Roster has 8 attrs, no `agility`; `speed` currently only sets *top-speed*
  bonus (`SPEED_STEP_BONUS`).
- **Derive from `speed` (chosen)** — `speed` becomes "athleticism": both top
  speed *and* ramp rate. Zero new surface area — roster, UI badges
  (`ATTR_META`/`signatureAttr`/`heatTier`), and the balance harness all stay as-is.
  Downside: can't model the slow-twitch speedster (high top speed, slow first
  step) or the quick-but-not-fast guard — a minor loss for a basketball sim. Same
  principle as Q21: don't add a knob for a need we haven't observed yet.
- **New `acceleration`/`agility` attr (9th stat)** *(documented upgrade path)* —
  the moment playtesting shows we want to model **top speed** and **first-step
  quickness** independently, promote ramp rate to its own attribute. Cleanly
  separates quick-twitch from top speed and unlocks the lumbering-big-with-
  long-speed and shifty-quick-guard archetypes; natural second job is to also
  modulate the Q5 angle×speed redirect cost (agile players bail/cut cheaper).
  **Costs when adopted:** every roster player needs a value (regen); UI gains a
  9th badge in `ATTR_META` (needs a glyph+label; `signatureAttr`/`heatTier` pick
  it up free since they iterate `ATTR_META`); `balance.ts` recalibration. **This
  is the first thing to do if accel-as-`speed` feels too flat.**
- **Inverse of `strength`/mass** — heavy bulls lumber, light players pop; no new
  attr, self-balancing, but overloads `strength` a third way, entangles balance
  (every strength tweak moves accel), and forbids the strong-AND-quick wing. Set
  aside.

### Q24 — Replan / interrupt model (can a committed sprint be re-steered each step)?
**[CHOSEN: free re-plan any step, governed by the Q5 cost — no hard lock]**
- Sharpens Q12 ("bail = re-target before arrival, redirect cost + accel reset"):
  is there ever a hard window where you *can't* re-steer?
- **Free re-plan, Q5 cost (chosen)** — you may issue a new order to any player
  every step; bailing a sprint pays the **Q5 angle×speed** penalty and **resets
  the accel ramp**. No hard lock — commitment is *purely economic*, never
  mechanical. Direct synthesis of Q5 (cost) + Q7 (per-step re-aim) + Q11 (tap per
  step) + Q12 (bail). **Captures hard-lock readability emergently:** bailing at
  top speed is so expensive that a full-speed sprinter effectively can't cut
  sharply → predictable in practice without ever being frozen. Keeps agency +
  bluff (Q15) high; avoids the rigidity Q2 rejected.
- **Commit windows (hard lock for N steps)** — sprint locks the line before you
  can re-steer; maximally readable but removes mid-sprint agency, contradicts Q7,
  and is the "locked heading" Q2 already rejected. Set aside.
- **Free re-plan, no cost (momentum just resets)** — re-steer freely, bail only
  drops you to jog/zero-accel with no angle×speed tax. Partly undoes Q5; bailing
  too cheap, commitment loses teeth. Set aside.

### Q25 — AI route planner (orchestrate routes/shots/passes/leads/screens, pure & cheap)?
**[CHOSEN: committed intents in serialized state + a predictive (Q16-legal) rollout selector]**
- Today's `aiPlan` (`ai.ts:105`) is a pure, **stateless, per-beat greedy** floor
  general (one order/player + optional shot via `shotEV`/`spacingOrders`/matchup
  scoring). At step cadence (~40–60 steps/possession) it must drive routes,
  multi-step gathers, passes + leads, and screens for 5 men.
- **The load-bearing choice** is whether the AI **holds a committed intent across
  steps**. It must: the model only grants sprint speed by *committing* a line, and
  re-targeting **resets the accel ramp** (Q12). So an AI that re-decides every
  step can never build momentum.
- **Committed intents + predictive rollout (chosen).** Each AI player carries a
  small **intent** in replay-exact serialized state:
  `{ kind: drive|cut|space|screen|gather|guard|help|contest, target,
  mode: jog|sprint, guard: abortCond, ttl }`. Per step: if the intent's guard
  trips / ttl expires / it's fulfilled → **re-select**; otherwise **continue the
  committed line** (re-emit the target so momentum keeps building). The AI thus
  *commits like a human* — readable, telegraphed, symmetric, beatable. **Selector
  = predictive rollout:** when an intent fires, choose it by a short forward
  rollout (predict the opponent as static / a fixed policy, roll the AI's own
  candidate routes forward a few steps, pick best) rather than a one-step greedy
  score. Pure & deterministic. Only the handler runs the richest branch
  (gather vs lead-pass vs drive, with lane-interception risk from the loose-ball
  primitive); off-ball is cheap cut/station selection; guards are simple
  distance/lane checks.
- **Selector richness is a swappable knob** along one axis:
  - *greedy score* — cheapest; the **downgrade fallback** if rollout cost bites.
  - *predictive rollout* — **chosen**; richer, still Q16-legal because it
    **predicts** the opponent, never reads your hidden order.
  - *best-response* — **off-limits**: to be useful at the current simultaneous
    step it needs your *actual* committed order, which Q16 hides (it would have
    to peek/cheat or resolve before you commit). The one line not to cross.
- **Stateless reactive per-step (A)** — no stored intent, re-derive every step.
  Cheapest/purest but re-targeting resets accel every step → AI never builds
  sprint speed (can't drive downhill, can't sprint to cut off a spot).
  **Disqualified by the model.**
- *Correction logged:* an earlier framing called *all* lookahead a Q16 violation
  — wrong. Only **best-response** lookahead does; **predictive** lookahead is
  legal, and its cheap form is just a richer intent-selector (it collapses into
  this option, not a rival architecture).

## Open decisions (not yet made)
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
