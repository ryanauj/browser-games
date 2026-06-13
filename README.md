# browser-games

A small collection of browser games built with Vite + React + TypeScript. The
landing page lists every game; each game lives in its own folder and is reached
by a hash route (e.g. `#/court-clash`).

**▶ Play online: https://ryanauj.github.io/browser-games/**

## Games

- **Court Clash** — *The Floor General*: real-time, beat-by-beat half-court
  5v5. You direct all five of your players — orchestrate drives, screens, cuts
  and passes on offense, and switch, double and help rotations on defense — one
  ~1-second beat at a time. Outcomes resolve as probabilities dominated by how
  open you get the floor (a wide-open role player beats a covered star), with
  eight per-player attributes running under the hood and surfaced only as a
  green/yellow/red risk glow. Steals, blocks and offensive rebounds are all in
  play, a short shot clock forces the issue, and stamina limits how much you can
  move your five. First to 15, win by 2. Tap a player for orders or drag to draw
  a route — and it's mobile friendly. See `src/games/courtClash/SPEC.md` for the
  full design.

## Adding a game

1. Create `src/games/<yourGame>/` that default-exports a root React component.
2. Register it in `src/games/registry.ts` with an `id` (its hash slug), title,
   tagline, and description.

The landing grid and the hash router in `src/App.tsx` pick it up automatically.

## Develop

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

Deploys to GitHub Pages on push to the default branch via
`.github/workflows/deploy.yml`.
