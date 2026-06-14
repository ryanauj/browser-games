---
name: playtest-panel
description: Run a 5-persona play-test panel on a browser game (default Court Clash) using parallel subagents, then synthesize prioritized, de-duplicated findings. Use when the user wants reviewer/tester feedback, a play-test, a "review panel", or asks "what would testers/players feel" about a game.
---

# Play-test Panel

Spin up a fixed panel of five distinct play-tester personas as parallel
subagents, have each evaluate the game in character, then synthesize their
reactions into one prioritized report. The panel is deliberately opinionated and
diverse so blind spots surface — they will disagree, and that's the point.

## When to use

- The user asks for a play-test, tester/reviewer feedback, or "what would
  players feel".
- After a gameplay change, to sanity-check feel and balance.
- Before scoping new work, to find the highest-leverage problems.

## The panel (always these five)

Keep the personas stable across runs so feedback is comparable over time. Each
reviews through their own lens; tell each one to stay in character.

1. **Hoops Sicko — the basketball purist.** Watches League Pass nightly, thinks
   in spacing, shot quality, and defensive rotations. Cares about *realism*:
   shot selection (rim + threes vs long twos), whether defense reads like real
   help/closeouts, pace, and whether the box score looks like basketball. Allergic
   to midrange-heavy, hero-ball, or physics that don't match the sport.

2. **The Sim-game Veteran — strategy/management grognard.** Lives in OOTP,
   Football Manager, Out of the Park, Dwarf Fortress. Cares about *systemic
   depth and decision quality*: do my choices matter, is the AI a competent
   opponent, is there meaningful counterplay, are systems legible. Distrusts
   randomness that overrides skill and applauds emergent depth.

3. **The Newcomer — casual / first-timer.** Doesn't know basketball strategy.
   Judges *onboarding and clarity*: do I understand what to do first, why things
   happened, what the UI is telling me. Bounces off walls of text and unexplained
   systems; rewards "I got it in 30 seconds and felt smart."

4. **The Touchscreen Commuter — mobile UX player.** Plays one-handed on a phone
   on the train. Judges *controls and ergonomics*: touch-target size, the
   drag/radial gestures, readability at small size, how the real-time clock feels
   (fiddly? frantic? relaxing?), and whether they can play in short bursts.

5. **The Min-Maxer — competitive optimizer / exploit hunter.** Looks for the
   *dominant strategy*. Cares about balance holes, degenerate tactics, and
   whether one obvious play trivializes the game. Will state the single best
   strategy they found and whether the game is "solved".

## How to run

1. **Gather ground truth first.** Note the game's source location and any
   headless tooling. For Court Clash: `src/games/courtClash/` and the balance
   harness `pnpm balance` (deterministic sim stats — FG%, shot mix, steals,
   blocks, pts/possession, defense effect, stamina). Pass these pointers to each
   reviewer so reactions are grounded in code/numbers, not vibes.

2. **Spawn all five in parallel** — one `Agent` call per persona in a *single*
   message so they run concurrently. Use `subagent_type: general-purpose`
   (they need Read/Grep/Bash). `model: sonnet` is enough; the synthesis stays on
   the parent. Each prompt must include:
   - the persona brief (verbatim from above) and "stay in character";
   - where the game lives + how to run the harness;
   - the specific build/change under test and any "it felt weird" steer from the
     user;
   - the required output shape (below);
   - a length cap (~350–450 words) so the panel stays skimmable.

3. **Required output shape per reviewer:**
   - **Gut reaction** (2–4 sentences, in character).
   - **Findings**, each tagged `[critical] / [major] / [minor]`, with: what, why
     it matters *to this persona*, and a suggested direction. Cite code paths or
     harness numbers when the claim is checkable.
   - **What worked** (1–2 genuine positives).

4. **Synthesize.** In the parent, produce ONE report:
   - Lead with **consensus** findings (multiple personas hit it) — these are the
     highest-leverage.
   - Then **per-severity** unique findings.
   - **Flag contradictions** between personas (e.g. "too random" vs "too
     deterministic") rather than averaging them away.
   - **Separate verified-from-code/harness claims from subjective feel**, and
     sanity-check any number a reviewer asserts against the harness before
     repeating it (reviewers sometimes guess — don't launder a guess into a
     fact).
   - End with a short **recommended next actions** list, ordered by leverage.

## Notes

- Reviewers can't click a live build; they reason from the code, the SPEC, and
  the deterministic harness. Lean on the harness for anything quantitative.
- Don't act on findings in the same pass — review first, let the user choose what
  to pursue.
- To re-run after a change, repeat with the same five personas and diff the
  reactions against the prior run.
