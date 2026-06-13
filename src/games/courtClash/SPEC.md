# Court Clash 2.0 — "The Floor General"

> Rework spec. Status: **awaiting sign-off**. Authored 2026-06-13 from a
> waterfall design interview. Supersedes the turn-based coaching-sim version.

## 1. Why we're reworking

The original Court Clash is a turn-based 5v5 coaching sim: each possession you
spend "coach energy" on substitutions and play cards, manage stamina/fouls
across four quarters, and read exact lane projections. Player verdict: **too
slow/fiddly, too number-heavy, no action or feel, and shallow/repetitive.**

We are replacing the gameplay almost entirely while keeping the basketball
theme and the project's reducer-engine architecture.

## 2. One-line pitch

You're the **floor general**. On a half-court, you direct all five of your
players in real time — beat by beat — orchestrating drives, screens, cuts,
passes and shots on offense, and switches, doubles and help rotations on
defense. Outcomes resolve as **stat-driven probabilities, dominated by how open
you get the floor.** First team to 15 (win by 2) wins. ~3 minutes a game.

## 3. Locked design decisions (from the interview)

| Topic | Decision |
|---|---|
| Theme | Keep basketball, 5v5 |
| Style | Real-time + light strategy hybrid |
| Cadence | **Beat-by-beat** (time advances in short discrete beats) |
| You control | All five of your players, **offense AND defense** |
| Orders | **Tap player → action menu**, and **drag to draw routes/passes** |
| CPU | Directs its own five; single well-tuned difficulty for v1 |
| Odds shown | **Risk indicator only** (green/yellow/red), no raw numbers |
| Stats | **Deep sim (6+ attributes)** — but hidden behind the risk glow |
| Outcome driver | **Spacing / openness dominates**; stats & stamina modify |
| Court | **Half-court** only for v1 (full court + transitions = later) |
| Visuals | **Simple sprites** (jersey'd figures) + glowing drawn routes |
| Feel | **Snappy & satisfying** (ball trails, shot arcs, swish pop, shake) |
| Bench | **None** — ride your five; stamina is the tension |
| Possession | **Alternate after each score** (check-up); you swap O/D |
| Scoring | **2s & 3s** |
| Win | **First to 15, win by 2** |
| Shot clock | **Yes** — short, counted in beats; expiry = turnover |
| Shooting | **You always call the shot** (tap the shooter) |
| Defense | **Man-to-man** base + switch / double / help (zone = later) |
| Sim events v1 | Shots (2/3), **steals/turnovers, blocks, offensive rebounds**. No fouls/free throws in v1. |

## 4. The core loop — "beats"

A possession is a sequence of **beats** (~1.2s of animation each).

1. **Hold (planning).** Between beats, time is paused. Every player has a
   **standing order** that persists until you change it. You touch only the
   players you want to redirect — tap a player for the action menu, or drag from
   a player to draw a route/pass. The risk glow updates live on contested
   choices. (This is how "control all five" stays un-fiddly: you adjust who you
   want, the rest keep doing their job.)
2. **Run the beat.** Commit (button or tap empty floor). The beat animates:
   players glide along routes, the ball moves, any contested events resolve.
3. **Tick.** The shot clock drops one beat.
4. **Repeat** to the next decision point until the possession ends:
   - a shot is taken and resolves (make, or miss → rebound contest),
   - a turnover (steal, bad pass, strip, block recovered), or
   - the shot clock hits 0 → **shot-clock violation = turnover**.

Possession then **alternates** (the other team checks up at the top of the
key). On a defensive rebound, the rebounding team becomes offense. On an
**offensive rebound**, the same team resets with a partial shot-clock reset.

## 5. Stamina (the limiter on "all five")

Each player has **Stamina 0–100**. Exertion drains it; easing off recovers it.

- Costs (per beat, tunable): sprint/drive/hard-cut/close-out ≈ high; jog/screen
  ≈ medium; stand/spot-up ≈ free or recover.
- A **gassed** player (low stamina) moves slower, loses a chunk of their contest
  odds, and **cannot sprint** until recovered above a threshold.
- Recovers between possessions and whenever a player isn't exerting.

Net effect: you *can* move all five every beat, but doing so repeatedly gasses
your team and tanks your odds — so you pick your moments.

## 6. Player attributes (deep sim, surfaced only as the glow)

Eight attributes drive every contest. They are **never shown as a stat line**
during play; they feed the green/yellow/red read and the resolution math. A
derived **role tag** (Slasher, Sharpshooter, Lockdown, Rim Protector,
Playmaker, etc.) is shown for flavor/identity.

| Attribute | Drives |
|---|---|
| Speed | First step, beating a closeout, transition (later) |
| Handle | Ball control on drives; resisting strips/steals |
| Finishing | Conversion at the rim |
| Shooting | Mid-range and 3-point makes (split into two sub-values internally) |
| Passing | Pass completion / quality of the look created; resisting lane steals |
| Strength | Post-ups, finishing through contact, rebounding |
| Perimeter D | Staying with drives, contesting jumpers, lateral quickness |
| Interior D | Rim protection / block chance, interior rebounding |

(Steal "hands" and Rebounding are derived from the above to keep the surface
small; can be promoted to first-class attributes if needed during tuning.)

## 7. Action vocabulary

### Offense — on-ball
- **Drive** (drag a direction): contest vs primary defender's Perimeter D +
  Speed, plus help defenders in the lane; openness of the lane dominates.
- **Shoot** (tap shooter; you always call it): 2 or 3 by floor location;
  odds from Shooting/Finishing − contest, openness dominates.
- **Pass** (drag to a teammate): ball travels the lane; can be **deflected /
  stolen** by a defender in/near the lane (their Steal vs passer Passing).
- **Post up**: back down near the block (Strength vs Interior D).
- **Reset / step-back**: create space, reset the read.

### Offense — off-ball
- **Move to spot** (drag), **Cut** (drag a path to the rim),
  **Set screen** (on- or off-ball, at a target), **Spot up / relocate**.

### Defense (man-to-man base)
- **Guard your man** (default assignment), **Switch** (swap assignments, e.g.
  on a screen), **Double** (send a second defender at the ball),
  **Help / rotate** (drop to fill the lane / cover a gap),
  **Contest** (hard close-out on a shooter), **Deny** (overplay a passing lane),
  **Go for steal/strip** (gamble — high reward, leaves your man if you miss),
  **Box out** (rebound positioning on a shot).

## 8. Resolution model

Each contested event computes a success probability:

```
p = clamp( BASE[action]
         + OPENNESS_WEIGHT * openness        // dominant term
         + STAT_WEIGHT     * (attackerStat - defenderStat)
         + stamina/positioning modifiers
         + small seeded randomness )
```

- **Openness** = function of distance to the nearest relevant defender and
  whether that defender is in correct position (closing out vs trailing vs out
  of the play). Getting a man wide open beats a covered star — this is the whole
  point of orchestrating the floor.
- Probability is **bucketed into outcomes** and surfaced as the **risk glow**
  (green = good look, yellow = contested, red = bad idea):
  - **Drive** → blow-by (advance, rim chance) / stalled / **stripped (TO)** /
    forced pickup.
  - **Shot** → make (2 or 3) / miss → **rebound contest** (off vs def rebound) →
    offensive rebound (reset) or defensive rebound (possession change).
  - **Shot/drive at rim** → **block** chance from a rim protector (Interior D).
  - **Pass** → complete / deflected / **stolen (TO)**.
- Determinism: a single **seeded PRNG** advanced by the engine (as today) so
  runs are reproducible and testable.

## 9. Match structure

- **First to 15, win by 2.** No game clock — the score target paces it. (Target
  is tunable; chosen to land near ~3 minutes with 2s & 3s.)
- **Shot clock:** ~12–14 beats per possession (tunable). Expiry = turnover.
  Offensive rebound resets it partially (~half).
- **Possession:** alternates after a made basket (defense checks up) and on a
  defensive rebound / turnover. You direct your five on whichever end you're on.

## 10. UI / presentation

- **Court:** half-court, top-down (slight tilt optional), one basket at the top.
- **Players:** simple jersey'd sprites for all 10 + the ball. Your five clearly
  distinct from the CPU's. Selected player gets a highlight + quick action menu;
  off-ball assignments shown as faint markers.
- **Routes:** drag from a player to draw a ghost path/pass lane, colored by the
  risk glow (green/yellow/red). Multiple standing routes visible at once.
- **HUD:** score, possession indicator, **shot-clock ring** (beats remaining),
  a "Run beat ▶" control, and per-player stamina pips.
- **Mobile:** large touch targets, drag-friendly, no hover dependence.
- **Onboarding:** a short interactive how-to and a few staged first-game tips
  (reuse the existing HelpModal / coach-tip pattern).

### Animation / juice (snappy & satisfying)
- Players **glide** along routes during a beat (eased transforms).
- **Ball trail** on passes; **arc** on shots; **swish** + brief screen shake +
  score pop on a make; **rim clank** + scramble on a miss.
- **Defender lunge** on a contest; **flash/steal** pop on a turnover;
  **rebound scramble** on a board.
- Shot-clock ring pulses red in the final beats.

## 11. Technical architecture (reuse the existing pattern)

- **Pure reducer engine** (`engine.ts`): `GameState` + `Action`s
  (`SET_ORDER`, `RUN_BEAT`, `CALL_SHOT`, `NEW_GAME`, …), deterministic via the
  seeded PRNG (`rng.ts`). Logical state is **discrete per beat**.
- **New `types.ts`:** players with the 8 attributes + stamina + role; on-court
  positions as continuous floor coordinates (x,y) rather than fixed slots;
  standing orders; ball state; possession/shot-clock state.
- **Hook (`useCourtClash.ts`):** owns the beat timer and animation lifecycle;
  interpolates sprite positions between discrete beat states (CSS transform /
  rAF) while the engine stays pure and synchronous.
- **Rendering:** absolutely-positioned DOM/SVG sprites on a court background
  (10 tokens + ball) — consistent with the current React/CSS approach; no new
  deps. Canvas only if perf demands it (unlikely at this scale).
- **AI (`ai.ts`):** the CPU floor general — picks orders for its five each beat
  from the same action vocabulary, using simple heuristics (attack the worst
  matchup, help off the weakest shooter, etc.).

## 12. Build phases

1. **Court & render shell** — half-court, sprites, score/possession/shot-clock
   HUD, static lineups at floor coordinates.
2. **Beat engine + movement** — state model, standing orders, beat advance,
   players glide along drawn routes (no contests yet).
3. **Offense contests** — drive / pass / shoot, openness model, risk glow.
4. **Defense** — man assignments, switch / double / help, steal & block
   contests, rebounds.
5. **Stamina** — drain/recovery, gassed penalties.
6. **Match loop** — possession alternation, 2s/3s scoring, first-to-15 win,
   game-over.
7. **Juice pass** — trails, arcs, swish, shake, lunges, scrambles.
8. **Onboarding & polish** — how-to + staged tips; update `registry.ts`
   tagline/description and `README.md`.

## 13. Tunable defaults (proposed; easy to adjust during play-testing)

- Beat length ≈ 1.2 s; shot clock ≈ 12–14 beats; offensive-rebound reset ≈ 7.
- Win target 15, win by 2.
- Openness as the dominant term in every contest; stat deltas as a secondary
  swing; stamina as a modifier and hard sprint-gate.

## 14. Explicitly out of scope for v1 (candidate later updates)

- Full court + transition / fast breaks + bench & substitutions.
- Zone defense.
- Fouls & free throws.
- Difficulty tiers (Rookie/Pro/All-Star).
- Roster/career progression, unlockable players & plays.
