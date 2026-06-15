# Court Clash — Continuation Prompt (2026-06-15)

> Paste this into a fresh session to pick up where we left off. It captures
> current state, locked design decisions, and open discussions. The code on
> `main` is the source of truth; this is the map.

## What this is
Court Clash: a turn-based, half-court 5v5 basketball game (you coach one team).
A possession advances **beat by beat** — you set orders, then tap **Next Beat**.
Pure deterministic reducer + a seeded RNG so games replay exactly.

Key files (`src/games/courtClash/`): `engine.ts` (sim/reducer), `ai.ts` (CPU
floor general), `index.tsx` (UI + interaction), `components/Court.tsx` (render +
drag), `constants.ts`, `types.ts`, `balance.ts` (self-play harness), `SPEC.md`,
`SPEC-FUTURE.md`.

## Validate every change
- `pnpm typecheck` and `pnpm build` must pass.
- `pnpm balance` — deterministic self-play harness. Watch: **shot mix**
  (layup/two/three), **defense effect** (% fewer AI pts when you guard vs idle),
  **steals**, **pace**. Current baseline ≈ **layup 7% / two 58% / three 35%**,
  **defense effect ~18%**, steals ~5/game.
- No headless browser in the remote env — can't screenshot the running app.
  For visual changes, reason carefully or hand the user a standalone SVG preview.

## Shipped recently (merged to `main`)
Screens overhaul (#16) · bodies take up space / collision (#18) · help-rim
defense + drive-and-kick (#19) · drag-to-shoot + prominent hoop + both-intents
radial (#20) · solid handler + strength/momentum collision shove (#21) · radial
always shows (#22) · lead passes to cutters / catch-in-stride (#23).

## Hard-won findings (don't relearn these)
- **Rim-finish volume is gated by ADVANTAGE STATES, not tuning.** Layups sit low
  (~4–7%) because, with goal-side defenders + instant help, the offense never has
  a genuine step on the D. Forcing drives → strip/kick blowups; settling →
  midrange. Constant-tuning thrashes. **Cutters (#23) are the first real
  advantage state** — that's the lever, plus possibly a contest-model change
  (contested layups make ~59%, so reaching the rim ≈ points regardless of D).
- **`SEPARATION_MIN` is a steep knob:** 3 keeps the drive-and-kick 3-pt identity
  (35% threes, def 18%); 4 shifts to rim pressure but kills threes; 5 collapses
  offense (threes ~2%, def ~9%). It's pinned at **3**.
- **Order of a beat (`runBeat`):** AI plans → **movement** (`advanceMotion`) →
  shot → pass → strips → clock. Movement resolves *before* the pass, so a pass
  already lands at a mate's post-move (led-forward) spot.
- Balance harness is seeded/deterministic — A/B sweeps are directly comparable.

## Queued work — LOCKED design decisions
### 1. Radial refinement (small, quick) — refines #22
Right now the radial always opens. The user wants it to open **only when there's
a genuine non-move choice** (shoot / pass / screen vs. move). A lone move/Help
(especially on defense) should just **fire** without a 1-item radial.
→ User wants to **MCQ the specifics first** before building.

### 2. Step-based motion + momentum (the big next direction)
Full design recorded in `SPEC-FUTURE.md`. Locked decisions:
- **Atomic unit → a single step** (not a beat). Deep change: AI planning, the
  clock, animation, and replay all assume beats.
- **Sprint is cancelable but costly** — breaking off a drive/cut decelerates over
  a step or two and can overshoot.
- **Direction changes cost speed + overshoot, scaled by a stat**
  (agility / handle / balance).
- **Input: decide-every-step first**, then design multi-step plan queuing after
  play-testing the per-step feel.
- Sequenced **after** cutters; cutters are the first taste of momentum and a
  probe for whether the full rewrite is worth it.

## Parked / branches
- **`claude/court-clash-rim-finish`** (pushed, no PR): per-player **strip
  cooldown** (`stripGuard`) so a multi-beat drive isn't re-stripped every beat.
  Inert with current AI; fold into finishing/cutter follow-ups.
- **CPU using cutters:** lead passes are currently a *player* tool — teach the
  CPU to cut and feed cutters.
- **Rim-finish recovery:** revisit once cutters/advantage states are in, possibly
  with a contest-model tweak (lower contested-rim make).
- `SPEC-FUTURE.md` Cluster B (roster economy / contracts): deferred long-term.

## Suggested next step
Play-test the give-and-go (#23) first — it changes the feel a lot and steers both
the radial polish and whether the step/momentum rewrite is worth it. Then either
the radial refinement (quick) or scope the step model.
