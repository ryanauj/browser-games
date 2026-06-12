# browser-games

A small collection of browser games built with Vite + React + TypeScript. The
landing page lists every game; each game lives in its own folder and is reached
by a hash route (e.g. `#/court-clash`).

**▶ Play online: https://ryanauj.github.io/browser-games/**

## Games

- **Court Clash** — a 5v5 basketball coaching sim played as a lane battler: Clash
  Royale clashes, Hearthstone-style play cards, NBA rotations. Both teams always
  have five on the floor (PG/SG/SF/PF/C); each possession the CPU coach moves
  first, in the open, and exact lane projections show who scores where. Athletes
  burn stamina every possession — gassed players collapse, the bench recovers —
  and defenders who get blown out pick up fouls (4 and they're gone for the
  game). Spend coach energy on substitutions and playbook calls, out-rotate the
  CPU across four quarters, and survive sudden-death overtime on a tie. Includes
  a how-to-play guide, staged coach tips, and an optional real-time 24s shot
  clock — and it's mobile friendly.

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
