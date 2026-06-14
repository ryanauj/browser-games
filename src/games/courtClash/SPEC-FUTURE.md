# Court Clash — Future Roadmap

> Forward-looking spec for two post-2.0 feature clusters, authored from a design
> interview on 2026-06-14. Status: **DESIGN — not scheduled.** This does not
> change the shipped 2.0 game (see `SPEC.md`); it records locked decisions and
> open questions so the work is ready to pick up later.
>
> The two clusters are independent and can ship in either order:
> **A. Continuous "real-time, pause-anytime" flow** (evolves the beat loop), and
> **B. Roster economy / "value GM" meta** (a layer around matches, ultimately
> multiplayer).

---

## A. Continuous flow — "real-time, pause anytime"

Today a possession is a sequence of discrete **beats** you commit one at a time
(`SPEC.md` §4). This cluster keeps that discrete, deterministic engine but lets
beats **chain automatically in real time**, with the floor general free to
**freeze and redraw whenever anything changes**.

### A.1 Locked decisions

| Topic | Decision |
|---|---|
| Time model | **Real-time, pause anytime.** Beats auto-chain and play continuously at an adjustable speed; tap to freeze, redraw any orders, resume. |
| Auto-pause triggers | **Turnovers & steals**, and **shots & rebounds.** Play halts and prompts a redraw on these. |
| *Not* auto-pause | "Someone gets open" and "defensive breakdown" do **not** auto-pause — the player watches for these and **pauses manually**. (Can revisit as optional toggles.) |
| Pause economy | **Unlimited pauses**, but **the CPU re-plans on every stop too** — symmetric. Stopping never grants the human free, unanswered micro. |
| Plan horizon | **Multi-step waypoint queues** per player: draw a sequence (move → screen → cut) that executes in order until it completes or you interrupt it. |
| Playbook | **Later phase.** Whole-team set plays (pick-and-roll, motion) are a candidate follow-up once waypoint queues feel good. |

### A.2 How it works

- **Engine stays pure and per-beat.** The reducer still advances one discrete
  beat at a time and stays deterministic via the seeded PRNG. The *hook* runs
  beats on a real-time timer instead of one-per-tap.
- **Global pause.** Pausing stops the timer for both sides (time freezes), opens
  the planning surface, and resumes on command. Auto-pause triggers fire the
  same freeze and flag *what* changed (e.g. highlight the turnover).
- **Symmetric re-planning.** The CPU already plans each beat; on any pause
  (auto or manual) **both** floor generals re-read the board so neither gets a
  free, unanswered adjustment.
- **Waypoint queues.** Extend a player's single standing **order** into an
  ordered **queue** of orders. When the head order completes (e.g. arrival at a
  waypoint), pop the next. Editing a player clears/replaces their queue. Routes
  render as a numbered multi-segment path.
- **Speed control.** A small speed selector (e.g. 0.5× / 1× / 2×) on the HUD;
  the shot clock continues to tick across the auto-run.

### A.3 Open questions

- Speed presets vs a continuous slider; default speed.
- Whether each auto-pause trigger is individually toggleable in settings.
- Waypoint UX: max segments per player, how to edit a mid-queue waypoint, how
  to show "currently executing" vs "queued".
- Do we keep an explicit "Run beat" single-step mode for learning/debugging?

### A.4 Phasing

1. **Real-time runner + global pause** — auto-chain beats on a timer; pause on
   the locked triggers (turnovers, shots/rebounds) and on user input; symmetric
   CPU re-plan on every stop; speed control.
2. **Waypoint queues** — per-player ordered order-queues + multi-segment route
   rendering and editing.
3. *(Later)* **Set plays / playbook** — authored multi-player choreographies.

---

## B. Roster economy — the "value GM" meta

A layer *around* matches: you manage **one team**, build it by acquiring players,
and every player has a **stat-driven value** gated by a shared salary-cap-like
**apron**. The long-term vision is **multiplayer** (two human GMs); single-player
vs CPU is the **testbed** to prove the systems.

### B.1 Locked decisions

| Topic | Decision |
|---|---|
| Player identity | **Real-inspired, renameable.** Ship fictional names whose ratings echo real-world archetypes; the player can rename anyone. (Avoids name/likeness licensing.) |
| "Changes with real life" | **Bundled data packs.** Periodic rating snapshots shipped with the app (no live API, no runtime network/data-rights dependency). |
| Trade legality | **Value budget + shared hard apron.** Acquisitions must keep total roster value under a single shared ceiling. |
| Value source | **Stat-driven** — a player's value is computed from their ratings, not hand-set. |
| Value formula | **Ratings-driven**, where the rating itself folds in a **weighted sum of the 8 attributes** plus **position** and **age** modifiers. Star-power (nonlinear premium for elite overalls) = **open question** below. |
| Value visibility | **Exact price tags.** Every player shows their exact value; trades validate automatically against the apron. |
| Market model | **Free-agent pool.** Acquire from a shared pool by spending cap room — no counterparty team to negotiate with (for now). |
| Apron shape | **Shared hard apron.** One ceiling for all teams: weak teams have room under it to climb, teams already at it must shed value to add. Naturally prevents the rich getting richer. |
| Meta structure | **Multiplayer-oriented.** For single-player testing, a **season + standings vs CPU** as a sandbox to exercise the economy. |

### B.2 Value model (proposed)

Computed, transparent, stat-driven:

```
overall(player) = weighted_sum(attributes, roleWeights)      // the 8 attrs, role-weighted
value(player)   = curve(overall) * positionMod * ageMod      // + optional star premium
roster_value    = Σ value(player on roster)
legal           = roster_value <= APRON_CAP                  // shared hard ceiling
```

- **Attributes → overall:** reuse the 8 attributes from `SPEC.md` §6, weighted
  by role so specialists are priced for what they do.
- **Modifiers:** position scarcity (e.g. a two-way wing premium) and an age
  curve (young-with-upside vs aging).
- **Apron:** a single shared cap; a transaction that would push `roster_value`
  over `APRON_CAP` is rejected. Optional **floor** (minimum roster value) so
  teams must field a real roster.
- **Data packs** periodically rewrite attributes → which re-derives every value,
  so "real-life form" flows through automatically with no extra pricing work.

### B.3 Open questions

- **Star-power premium:** how nonlinear should `curve(overall)` be — is a 95
  worth modestly or *exponentially* more than two 85s? (User undecided.)
- Roster size & position requirements (starters + bench? must-fill positions?).
- Free-agent pool: size, refresh cadence, and whether released players re-enter.
- Age/development curves advancing within a single-player season.
- Data-pack format, source, and update cadence (names fictional; stats as facts).
- **Multiplayer specifics:** async vs live; how two GMs share/contest the same
  free-agent pool; whether trades between human teams reopen the counterparty
  negotiation model dropped from v1.

### B.4 Phasing

1. **Value engine** — attributes → overall → value formula + apron check; pure,
   testable, no UI.
2. **Roster + free-agent pool UI** — view your team and the pool with exact
   prices, sign/release under the apron, rename players.
3. **Data-pack format** — load a rating snapshot that re-derives all values.
4. **Season vs CPU (testbed)** — standings + a schedule that exercises the
   economy across a season.
5. *(Later)* **Multiplayer** — two human GMs; resolve the open questions above.

---

## C. Relationship to shipped 2.0

Neither cluster changes the 2.0 rules in `SPEC.md`. Cluster A **evolves the beat
loop** (§4) from tap-to-commit into a real-time runner with pause-anytime and
waypoint queues; the deterministic per-beat reducer is preserved. Cluster B is a
**new meta layer** that feeds rosters into the existing match engine and is the
on-ramp to multiplayer.
