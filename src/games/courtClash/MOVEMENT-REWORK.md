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

### Q26 — Stamina economy shape for the step model?
**[CHOSEN: per-step mode cost + Q5 redirect tax + recover-when-slow; magnitudes deferred to `pnpm balance`]**
- `STAMINA_COST` is per-**beat** by exertion kind (`idle -6, move 5, cut 11,
  drive 12, …`). Q10 deletes beats and the discrete cut/drive verbs; movement is
  continuous jog/sprint per step plus new continuous taxes (Q5 redirect, accel).
  Q2's payoff *depends* on a continuous reaction tax tiring a mirroring defender.
  Worry: now everyone reacts continuously, so magnitudes could gas the floor.
- **Per-step mode + Q5 tax (chosen)** — port `STAMINA_COST` from beat-kind to
  **step-mode**: jog ≈ cheap, **sprint drains** (scaled by speed/accel), idle/slow
  **recovers**; the **Q5 redirect cost doubles as the stamina tax** — that *is*
  the reaction tax. Right gradient falls out for free: mirroring a *jogging*
  handler is low-speed ⇒ low angle×speed ⇒ cheap (consistent with Q21 deferring
  the jog-smother); mirroring a *sprinter* forces sprint+redirect ⇒ expensive ⇒
  the mirror tires and surrenders a step (Q2). Decide the **shape** now; **defer
  magnitudes** to `pnpm balance` once a step sim exists (can't calibrate a sim
  that isn't built — watch the stamina avg/min line).
- **Continuous work model (drain ∝ speed²/work)** — super-linear; sustained
  sprints gas you, fewer per-kind constants, more self-balancing — but a bigger
  departure, harder to map to existing targets, swingier sprint pacing. Set aside
  (a possible later variation).
- **Defer entirely (placeholder costs)** — decide nothing until the engine runs.
  Honest but punts the structural what's-taxed/recover-when question we can settle
  now. Set aside.

### Q27 — Validation gates (which guardrails become hard gates vs advisory)?
**[CHOSEN: advisory-report all balance/feel metrics; keep only deterministic-replay as a correctness check; promote feel metrics to hard gates later once a config feels good]**
- `balance.ts` currently **reports** (shot mix, 3PA, steals/blocks/clock-TOs,
  pace, stamina avg/min, defense-matters %) but mostly doesn't *assert*; pace is
  keyed on beats (Q10 deletes beats; possessions survive).
- **Key reframe (from discussion):** two different things were wearing the
  "validation gate" label, and they're not the same:
  1. **Balance/feel metrics** (shot mix, steals, pace, defense-matters %). As
     gates these only assert *"don't regress from current state"* — but current
     play isn't good, so freezing this baseline is counterproductive: it locks in
     a config we don't like and false-fails the moment the rework *legitimately*
     moves balance (the whole point). **No business being hard gates now.**
  2. **Deterministic replay.** Not a feel target — a **correctness invariant**
     (same seed + inputs ⇒ byte-identical game). The rework structurally depends
     on it (pure reducer, sub-steps replay exactly); if it breaks, that's a
     *non-determinism bug*, not a balance opinion. It's also load-bearing for the
     harness itself: if the sim isn't deterministic, every metric it prints is
     noise. Worth keeping regardless of whether play feels good — really a
     correctness *test*, not a balance gate.
- **Advisory + keep determinism (chosen)** — all balance/feel metrics stay
  **advisory prints**; the **only** thing asserted is **deterministic replay**
  (protects the harness, catches non-determinism bugs). Migrate the pace print
  `beats/game → steps/game`. **Promote feel metrics to hard gates LATER** — once
  the rework converges on a config that feels good and we want to *defend that*
  ("this is working, lock it in").
- **Pure advisory, nothing asserted** — even simpler, but a non-determinism bug
  would silently make every harness number untrustworthy. Set aside (determinism
  is cheap to keep and protects everything else).
- **Tiered / all-hard gates now** — assert invariants + band-gate rates from the
  start. Set aside: brittle mid-rework and freezes a baseline we don't like. This
  is the *destination* (post-convergence), not the *starting* posture.

*All open decisions from the rework are now resolved (Q21–Q27). Remaining work is
implementation + harness tuning against `pnpm balance`, not further spec.*

## Implementation-clarification decisions (logged during Session 1 — core engine)

These came up while building Phases 1–2 and weren't pinned down above; recorded
here in the same format so they can be swapped later.

### Q28 — Do the `cut`/`drive` order verbs survive, or fold into `move`+mode?
**[CHOSEN: retain `drive`/`cut` as sprint-mode specializations; defer the verb cleanup to the actions session]**
- Q13 adds `mode: 'jog'|'sprint'` to `move`; Q26's aside says Q10 "deletes the
  discrete cut/drive verbs." Folding everything into `move`+mode is the clean
  endpoint, but `drive` carries action semantics this session doesn't touch —
  solid-body `driveCollision`, the on-ball strip check, the finishing prime — and
  the deferred-actions code + UI (`index.tsx`, `Court.tsx`) still construct/read
  the verbs.
- **Retain as sprint specializations (chosen)** — `move` gets the explicit
  `mode`; `drive`/`cut` are treated as `sprint` everywhere movement is computed
  (one `moveModeOf(order)` maps them), so they ride the SAME accel ramp + redirect
  + momentum machinery. Lowest-churn, keeps the deferred verbs working, and the
  movement physics are genuinely unified under the hood. The literal verb deletion
  (drive ⇒ "ball handler + move/sprint at the rim") lands in the **actions
  session** when shots/strips/screens are reworked anyway.
- **Delete now, fold into `move`** — the clean schema, but forces a rewrite of the
  out-of-scope action/UI code this session and risks regressions in systems we're
  told not to touch. Set aside (the destination, not this session's step).

### Q29 — Does decelerating a sprint to a jog (not a turn) pay the Q5 tax?
**[CHOSEN: only a sprint→new-heading turn pays angle×speed; a straight decel/stop is free]**
- Q5 is "angle×speed." A clean stop or downshift to a jog has no *angle*, so the
  cost is ill-defined.
- **Turn-only tax (chosen)** — the redirect cost fires only when a player is
  sprinting AND re-aims onto a new heading beyond `REDIRECT_FREE_ANGLE`; the tax
  and ramp-reset both scale with the turn. Dropping to a jog (or arriving) just
  decelerates the ramp to zero for free — consistent with Q12's "arrival = a
  natural decel/stop." Keeps a gentle curve nearly free and a hard cut at speed
  brutal, without taxing an honest stop.
- **Tax any speed loss** — would also bite a straight stop; over-penalizes and
  muddies the "commit a *line*" reading. Set aside.

### Q30 — How is per-step resolution made ORDER-INDEPENDENT (not just deterministic)?
**[CHOSEN: two-phase plan→resolve from the start-of-step snapshot, with a fixed-roster-order tie-break]**
- The Session-1 checkpoint found resolution was **deterministic but NOT
  order-independent**: `applyMovement` ran ONE pass over the fixed roster
  `[player-0..4, ai-0..4]`, so two contacts leaked iteration order. (1)
  `driveCollision` *overwrote* a bulled defender to `defStart + shove`, so the
  defender's own jog was **compounded** when the player drove (driver iterated
  first) but **discarded** when the AI drove (defender iterated first) — a
  home-side asymmetry from identical inputs. (2) Off-ball `contestedStep` read
  **live** (already-moved) opponent positions, so a later-iterated mover saw
  bodies an earlier one didn't. Q16/Q25 (simultaneous rollout AI) needs this to
  be ball-side-symmetric to trust the sim.
- **Two-phase plan→resolve (chosen).** Split `applyMovement` into **PLAN** —
  from the `before` snapshot, compute every player's intended next position
  (accel/jog/redirect per Q4/Q5) reading ONLY `before`, committing no position —
  then **RESOLVE** — resolve contacts (bull-shove, `contestedStep` slow-down)
  against that buffer, every other body still read from `before`. A bull shove is
  *returned* and applied **additively on top of** the bulled defender's own
  planned jog, so the jog survives regardless of who iterated first. Because
  nothing commits until both phases finish, every target/heading/contact reads
  the revealed (last-step) state — a built-in 1-step read lag, exactly Q16. Net:
  the bulled-defender outcome is now identical on either ball-side (probe
  `probe-orderdep.ts`: |Δ|=0 across seeds; before, |Δx|≈7.4). The player-on-
  offense bull path keeps its shove-then-jog intent (jog kept); only the AI-on-
  offense path is corrected (jog no longer discarded). Replay bytes legitimately
  shift (AI-on-offense plays out differently); the determinism gate stays GREEN.
- **Tie-break when two players contest the same spot:** movers plan
  independently from `before`, so two can plan into the same cell; the overlap is
  broken by `separateBodies`, which iterates the **fixed roster order
  `[player-0..4, ai-0..4]`** with the strength+momentum shove math and a **fixed
  `+x` axis for exactly-coincident bodies**. That order does not depend on which
  side holds the ball, so the same configuration resolves identically on either
  ball-side (side-symmetric).
- **Role-based resolution order (offense resolves first, then defense reacts to
  the offense's resolved spots)** — would also be order-independent and would
  keep player-on-offense byte-identical, BUT it grants the defender a 0-step
  in-step *peek* at the offense's new position, contradicting Q16's 1-step read
  lag. Set aside (the plan→resolve-from-`before` design is the Q16-faithful one).
- **Keep the single pass, just fix the overwrite (add jog to shove in place)** —
  patches defect (1) but not (2) (`contestedStep` still reads live), and still
  leaves the result coupled to array order in mixed pile-ups. Set aside as a
  half-measure.

## Implementation-clarification decisions (logged during Session 2 — actions: ball + shots)

Built on the merged step engine (Q30 two-phase resolve, determinism GREEN). This
session lands the traveling-ball entity (Q18), passing as that entity, and the
gather→release shot (Q17). Same format so they can be swapped later.

### Q31 — Concrete traveling-ball entity shape (the frozen Q18 contract UI/AI build on)
**[CHOSEN: an additive `GameState.ball: Ball | null`; while it exists `ballHandlerId` is null]**
- The blocker for UI/AI was a *documented* entity shape. Committed FIRST, before
  any behavior, so screens/AI sessions can target it. The shape (see `types.ts`
  `Ball`): `{ pos, vel, from, fromId, targetId: string|null, to, kind:
  'pass'|'shot', lead: boolean, steps }`. All serialized → an in-flight pass
  replays byte-identical (the hard gate).
  - **In flight ⇒ `ballHandlerId === null`.** This is now a *valid, handled*
    `phase==='play'` state, not a crash. Guarded the prior session's flagged
    non-null assumptions: `applyMovement` takes an explicit `offense: Side` (the
    off-ball branch keys off it, not `ballHandler.side`, so off-ball movers still
    cut/relocate while the ball flies); `runStep`'s pass/strip/gamble blocks are
    already under `if (handler)` so they no-op in flight. The order-dep probe's
    2-arg `applyMovement` call still works (offense defaults to the handler's side).
  - **`lead` distinguishes the two target modes** Q18 calls for: a *direct* pass
    (`lead:false`) HOMES — `to` is re-aimed to the receiver's current spot each
    step, so it curves onto a moving target and (barring interception) is a sure
    catch; a *lead* pass (`lead:true`) flies to a FIXED `to` spot a cutter must run
    onto (caught only if the receiver is within `LEAD_CATCH_RADIUS` of it, else it
    sails — an errant-pass turnover). `targetId` is the intended catcher in both.
  - **Shots resolve at release, not as a flight (this session).** `kind:'shot'`
    is in the union as the frozen contract, but a shot currently resolves
    make/miss the moment the gather releases (Q33) rather than launching a shot
    ball to the rim — the UI already animates the make/miss arc from the
    `shotMake`/`shotMiss` events, so no shot-ball is needed for visuals yet.
    Wiring a real shot-ball flight (block-at-release, then resolve on arrival at
    the rim, unifying rebounds as a loose ball — the Q18 unification note) is a
    clean later extension that needs no schema change. Flagged for fan-out.

### Q32 — Pass interception: positional (read the lane) vs a dice roll
**[CHOSEN: purely positional — a defender body in the travel lane picks it off; no roll]**
- Q18/Q20 want steals to be *positional + anticipatory* ("read the lane, step into
  it"), and the task says reuse `contestedStep`/separation geometry over a dice
  roll where possible. So the old probabilistic `passStealChance` (a per-pass
  `PASS_STEAL_BASE` roll) is **replaced for in-flight passes** by a geometric
  check: each step the ball advances along a segment, the nearest opponent within
  `PASS_INTERCEPT_RADIUS` of that segment (and actually in the ball's path) **picks
  it off** — deterministic, skill-expressing (leave a man in the lane and you lose
  it), and it makes lead passes a real read. `passStealChance` is kept exported for
  the UI's risk glow (it still wants a 0..1 to color the pass target).
- **Radius choice:** `PASS_INTERCEPT_RADIUS = 2.8`, just over the placeholder AI's
  own `laneClear` threshold (a defender within ~2.2 of the lane makes the AI hold
  the ball), so AI-vs-AI it threads clean passes and interceptions are rare; a
  *human* who leaves a defender in the lane gets picked. Tunable; advisory only.
- **Tradeoff / risk:** a binary in-lane = 100% pick can feel harsh and removes the
  passer's attribute from the in-flight result (passing only sets ball speed now).
  Acceptable for the positional model; if playtest wants nuance, layer a deflect-
  vs-clean-pick or a passing-vs-perimeterD modulation on the geometric hit later.
- *Steals/possessions will move in `pnpm balance`* — intended (Q27 advisory).

### Q33 — Shot = multi-step gather→release (Q17), composed with existing per-step state
**[CHOSEN: a `GameState.gather` windup; shooter rooted; make%/block read at release]**
- Replaces the instantaneous shot. `CALL_SHOT` (human) and the AI's `plan.shoot`
  both **start a gather** (`{ shooterId, release }`) instead of resolving on the
  spot; the shooter is rooted (order→idle) for `release` steps while the defense
  can close, then the shot resolves against the **post-closeout** floor — so a
  good closeout *during* the windup deters/contests the look, exactly Q17. Open vs
  contested make% flows unchanged through the existing tables (`shotMakeChance`
  reads `openness`, `blockChance` reads the nearest contester at release).
  - **Gather length** `GATHER_BASE − quick-release(shooting)` → **2–3 steps**
    (`gatherStepsOf`); a high-`shooting` shooter releases a touch quicker. Kept
    short to bound pace drift and the determinism surface.
  - **Composes with `primed`/`bull` rather than re-deriving them** (per the task):
    a shot off a drive sets `primed` to survive the whole windup (it would
    otherwise decay during the gather and lose the `DRIVE_FINISH_BONUS`); the
    `p.bull` loose-handle still feeds the on-ball strip while the handler holds the
    ball, and a committed gather can't be aborted mid-windup (rooted) — readable,
    like a real shooter who's already left his feet. Abort-on-hard-contact is a
    possible later nuance.
  - **`CALL_SHOT` now begins a windup + advances a step** rather than resolving
    instantly; the action surface is unchanged (the UI still dispatches
    `CALL_SHOT`), only its timing. Telegraphing the gather in the UI is a later
    (Q14/Q15) session.
  - **⚠️ Worth testing later — rim finishes are block-heavy under the gather.**
    The windup lets the rim protector fully collapse before release, so layups at
    the rim resolve almost entirely as *blocks* (in self-play `pnpm balance` the
    layup shot-mix share reads ~0% — they're attempted, just contested, and a
    `block` event isn't counted as a shot). Threes/twos look healthy (~85/15,
    1.0 pts/poss); only the rim-finish path is over-deterred. Left as-is this
    session (determinism is the gate; balance is advisory/deferred) — the
    balance/tuning session should test softening the closeout-during-windup
    (shorter gather near the rim, a quick-finish for `primed` drives, or a
    release-window where a late-arriving contest can't fully smother) so downhill
    finishes score at a sane rate.

### Q28 (revisited) — verb reconciliation under the step+actions model
The `Order` union's **verb surface is unchanged** this session (drive/cut/move/
pass/screen/guard/double/help/steal) — UI and the coming AI session target the
same shape. What changed is *wiring*, not verbs: `pass` is no longer a one-shot
`BeatEvent`-style resolve (it launches the Q31 ball), and a shot is a gather (Q33)
rather than an instant resolve. `drive`/`cut` remain the sprint specializations of
the move order (the Q28 retention). The literal verb deletion (fold drive/cut into
move+mode) is still deferred — folding it now would churn the UI/AI surface the
other sessions are building against, for no behavioral gain.

## Session 5a — balance convergence pass (fix the metric, tune rim↔three)

The movement rework merged GREEN but self-play was a rim-or-bust game (layup
82% / two 1% / three 17%, FG 64, 3P 21, 1.1 pts/poss) and the defense-matters
harness metric printed nonsense (−625%). This session fixed the metric, then
tuned the scoring/contest balance toward a distribution that reads like
basketball. Balance stays advisory (Q27); determinism is the only hard gate
(GREEN across 10 seeds after every change).

### Q34 — Honest "does defense matter?" metric (fix the −625% inversion)
**[CHOSEN: per-possession compare over EQUAL first-N possession samples, bounded]**
- The old `balance.ts` metric did `(idlePP − guardPP)/idlePP` over RAW possession
  totals and printed **−625%**. Doubly confounded: (a) an idle game never ends
  (the player scores 0), so it runs to STEP_CAP and the AI piles up ~5× the
  possessions of a guarded game that reaches 15 and stops (~66 vs ~15 poss/game);
  (b) those extra trips are garbage-time that drag the idle average down, and
  dividing the delta by the tiny idle rate magnified the sign error.
- **Fix:** track AI points per AI offensive possession in order; for each seed
  compare the **first N** AI possessions of both runs (N = the shorter run's
  count — equal samples, no garbage tail). Report the effect as a swing bounded
  to **[−100%, +100%]** (`(guardPP − idlePP)/max(guardPP, idlePP)`), which can
  never print a −625%.
- **TRUE finding (confirms the playtest panel): guarding does NOT suppress AI
  scoring — it RAISES it (+82%).** Idle defenders freeze goal-side = SET (zero
  motion) = max bull anchor, so they wall every drive and the possession dies on
  the clock; active guarding pulls them off that planted spot, which is when the
  AI scores. So "defense matters" is currently a *rim-anchor* artifact, not a
  contest effect — the real defensive lever (help rotation that walls the lane
  while staying set) is Session 5b. The fixed metric is what makes 5b measurable.

### Q35 — Rim↔three rebalance (kill the 82/1/17 extreme)
**[CHOSEN: trim the rim freebie + buff open threes; constants below]**
- **Rim was too cheap.** A SET even-strength defender only *tied* an average
  full-speed bull (driverPush ≈ 2.105 = mass 1.0 + 0.1×sprintTop 11.05 vs set
  anchor 1.0 + `SET_ANCHOR_BONUS` 1.1 = 2.10), so the average drive bulled
  through by default. **`SET_ANCHOR_BONUS` 1.1 → 1.3** (set anchor 2.30 > 2.105):
  a planted even-strength defender now STOPS the average drive; the bull becomes
  a strength/speed-edge play. **`DRIVE_FINISH_BONUS` 0.12 → 0.05** and
  **`SHOT_BASE.layup` 0.52 → 0.48** so an open finish (≈68%) is good but not a
  free 1.6-EV bucket.
- **Threes were too weak.** `shotMakeChance` taxed range at **×0.45**
  (top-of-key d≈47–53 lost 0.06–0.14 on top of the closeout contest), so open
  threes realized ~21%. **rangePenalty coefficient 0.45 → 0.28** and
  **`SHOT_BASE.three` 0.22 → 0.25**: open looks now land at ~45–47% (≈34–36% for
  an average shooter), realistic; self-play realized 3P sits at **27%** because
  the closeout-during-gather contests them to openness ~0.44 at release (a real,
  intended tax — open looks are the 5b/spacing payoff).
- **Result:** mix **82/1/17 → 67/4/30**, 3P 21 → 27, FG 64 → 51, pts/poss
  1.1 → 0.9. The remaining gap to the ~40/35/25 target is **structural and
  deferred to 5b**: in defense-less self-play the rim is genuinely uncontested
  (layups release with block-prob ~0.09 — the driver attacks the *gap beside*
  the planted Center, a help-rotation matter), so driving is correctly the best
  EV. Pushing the make-tables further to force 40/35 in self-play would over-fit
  a floor with no lane defense and make open looks unrealistic. Pace held at
  **~36 steps/possession** (unchanged per-poss); not touching the accel windup,
  since the task's precondition ("once the rim isn't a free bucket") isn't met
  until 5b walls the lane.

### Q36 — AI shot-value ↔ engine contest alignment (`shotEV` ignored block)
**[CHOSEN: fold a positional block estimate into `shotEV`]**
- The panel flagged that `shotEV` (the CPU's rollout valuation) reads the
  open-floor make and **ignored `blockChance` at release** — so it overvalued a
  rim finish (drives into a rim protector it can't see). Confirmed. While the rim
  was a free bucket this matched reality; re-nerfing the rim (Q35) makes the
  misalignment bite.
- **Fix:** `shotEV` now multiplies make by `(1 − blockEstimate)`, a cheap mirror
  of `engine.blockChance` (nearest contester within `CONTEST_RADIUS`, steeper at
  the rim, scaled by proximity × interior D) **replicated** in `ai.ts` to keep
  the ai←engine dependency one-way. A contested rim attack now scores below a
  clean kickout in the rollout. Effect in self-play is modest today (real
  finishes are uncontested, block ~0.09) but it's the honest valuation and will
  matter once 5b puts a body at the rim. Pure/deterministic (no RNG) — gate GREEN.

### Q37 — Committed defensive cutoff (Q9), implementation finding
**[BUILT in 5b. Key finding: the cutoff must PLANT, not chase.]**
- The defensive half of the commit/react read-game (Q9) is now expressible: a
  `help` order carries a `MoveMode`, and `moveModeOf` maps `help+sprint` to a
  committed sprint that flows through the SAME two-phase machinery offense uses
  (accel ramp, angle×speed bail). `planDefense` issues it for the on-ball man
  when the handler is on a committed drive line — read off his REVEALED
  `sprintSpeed`/`sprintDir` (Q16-legal; never his hidden this-step order).
- **The geometry is load-bearing.** A naive cutoff that targets a spot a fixed
  distance *ahead along the driver's heading* never works: that spot recedes
  ~1 step/step with the driver, so the defender chases it forever, **never
  plants**, never becomes a SET body, and just vacates his man — which the Q25
  rollout offense punishes (defense-effect **+79%** in isolation, a pure leak).
  Anchoring the plant point to a **goal-side chokepoint on the lane TO the rim**
  (a fixed spot the driver is heading INTO) lets the defender beat him there,
  stop, and anchor — and the bull contest favors the SET body. That alone drops
  the isolated cutoff to **+21%** (≈ the tight-passive-man floor) and spikes
  shot-clock TOs (stuffed drives). Lesson: a committed cutoff is only defense if
  it ends in a *plant*.

### Q38 — Gamble-steal read (Q20), EV against a rollout offense
**[BUILT in 5b. Gated to "nothing to lose".]**
- The AI now ISSUES the `steal` the engine already resolved: when the handler's
  handle is loose (`bull > 0`, revealed), the nearest on-ball defender lunges.
- **EV finding:** against the Q25 predictive-rollout offense a missed reach-in is
  very expensive — the gambler is STUCK several steps, surrendering the on-ball
  man, and the rollout exploits that multi-step opening harder than the made
  steals save. An ungated gamble leaks (cutoff-only +21% → +cutoff+gamble +71%).
  So the read fires only with **nothing to lose**: the loose handler has already
  bulled into a near-certain finish (inside `GAMBLE_THREAT_RIM`), where a miss
  costs ~nothing (he scores anyway) and a strip denies the bucket. The miss cost
  itself is unchanged (Q20 "existing cost"). In the *shipped full defense* the
  gamble is net-positive (guarded 0.9 → 0.6 pts/poss) — its takeaways claw back
  what the pre-existing help rotations leak.

### Q39 — Why guard-vs-IDLE stays positive: the rollout offense punishes telegraphs
**[RECORDED. Dominant residual leak is the pre-existing help rotations — a
5a-owned re-tune, flagged, not chased here.]**
- 5b's reads measurably suppress AI scoring vs the 5a baseline (guarded **0.9 →
  0.6** pts/poss, FG **53 → 49**, steals **7 → 17**/game, effect **+82% →
  +75%**), yet the corrected defense-matters *sign* stays positive (guarding
  still RAISES AI pts/poss vs IDLE). This is not a 5b regression — it's the
  structure of the metric × the Q25 offense:
  - The metric's "IDLE" baseline isn't "no defense": per-possession setup hands
    every defender a persisted `guard` order, so IDLE is **tight passive
    man-to-man**. Against the near-optimal rollout offense, passive man gives
    **nothing to read** (every man mirrored at the 1-step lag) and is the AI's
    kryptonite — pure man holds it to ~0.2 pts/poss.
  - **Any** active rotation that VACATES a man (rim-drop, double-team, an
    overcommitted cutoff) opens a look the openness-reading rollout punishes.
    Isolation shows the dominant leak is the **pre-existing help rotations**
    (rim-drop + double): turning them off drops the full defense from +82% toward
    the ~+16% pure-man floor. The on-ball cutoff (planted) and the EV-gated
    gamble are NOT the main leak.
- **Implication / recommended follow-up (5a-owned tuning, out of 5b scope):**
  the committed cutoff is the first-principles replacement for the leaky rim-drop
  (Q9). A coherent next step is to lean on the on-ball cutoff and **retire/tighten
  the help-rotation drops** so active defense stops vacating men — that's what
  flips the sign. Also note these reads are balanced FOR human offense, where a
  telegraphed cutoff / gamble is a real mind-game, not a free exploit; the CPU
  rollout is a worst-case adversary for any committed defense.

## Variation ideas to try later (compare/combine)

- Accel ramp (Q4) **+** engine-internal chaining (Q3 alt) as a low-risk first
  cut before building the route UI.
- Locked-heading (Q2 alt) **+** acceleration ramp — more telegraphed, more
  readable defense; compare feel vs the redirect-cost version.
- Flat-speed + momentum-as-bull-only (Q4 alt) as the *minimal* fix to the
  guard-lag bug (two-phase tracking) without changing travel speed — useful A/B
  baseline to isolate how much the accel ramp actually changes balance.
