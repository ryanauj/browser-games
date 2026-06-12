# browser-games

A small collection of browser games built with Vite + React + TypeScript. The
landing page lists every game; each game lives in its own folder and is reached
by a hash route (e.g. `#/court-clash`).

**▶ Play online: https://ryanauj.github.io/browser-games/**

## Games

- **Court Clash** — a 5v5 basketball strategy card battler mixing Hearthstone-style
  energy/turns, Clash Royale simultaneous clashes, and NBA 2K player cards. Draft a
  lineup across five positions (PG/SG/SF/PF/C), play power-ups, beat the real-time
  shot clock, and outscore the CPU across four quarters (with overtime on a tie).

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
