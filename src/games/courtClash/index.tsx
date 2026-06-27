import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASKET, LEAD_CATCH_RADIUS, MAX_QUEUE, PASS_LANE_RADIUS, SPRINT_FLOOR, WIN_TARGET, riskOf, type Risk } from './constants'
import { orderDone, passStealChance, shotMakeChance } from './engine'
import { dist, distToSegment, leadCatch, nearestOpponent, reachOf, stepToward } from './geometry'
import { useCourtClash } from './useCourtClash'
import type { BeatEvent, MoveMode, Order, Player, Side, Vec } from './types'
import { AttrPanel } from './components/AttrPanel'
import { Court, HOOP_HIT, type BallFlight, type RadialItem } from './components/Court'
import { DebugPanel } from './components/DebugPanel'
import { GameLog } from './components/GameLog'
import { GameOverModal } from './components/GameOverModal'
import { HelpModal } from './components/HelpModal'
import './courtClash.css'

const HELP_SEEN_KEY = 'courtclash-help-seen'
const COACHED_KEY = 'courtclash-coached'
/** First-run, learn-by-doing nudges — advance as the player actually acts. The
 *  first beat points at the ball handler (the glowing 🏀 token) so a newcomer
 *  knows who to act on; only tapping THAT player advances, so a stray tap on an
 *  off-ball teammate doesn't burn the intro. The second beat then points down at
 *  the action bar that just opened — one concrete next instruction, plus the only
 *  in-flow definition of a "step" (otherwise buried in the Help modal). */
const COACH_STEPS = [
  '👋 You\'re on offense. The glowing 🏀 token is your ball handler — tap them (or drag) to give the first order.',
  '👇 Now pick one of the actions below for this player — or 📋 Plan a multi-step chain. (A "step" = one simultaneous move by all players; the ▶ button down right plays it out.)',
]
const YOU: Side = 'player'
/** Floor-unit radius for treating overlapping sprites as a tappable stack. */
const STACK_RADIUS = 9

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — onboarding just repeats */
  }
}

/** Build the ball's travel for the resolution step just resolved from its events,
 *  so the UI can fly the ball along it (catch, shot → rebound, steals, errant
 *  throws). The engine stamps each event with from/to coords; this picks the
 *  salient flight and, for passes, flags the defender nearest the lane.
 *
 *  A traveling pass already shows step-by-step as the live `ball` token, so for
 *  pass/steal/turnover we fly the final gather leg from `lastBallPos` (where the
 *  token actually was last step) rather than the original release point — no
 *  jump-back. Shots resolve in one step (no live token) so they keep their
 *  release→rim arc. `lastBallPos` is null for a one-step pass (caught at launch),
 *  which correctly falls back to the release point. */
function deriveBallFlight(
  events: BeatEvent[],
  players: Player[],
  key: string,
  lastBallPos: Vec | null,
): BallFlight | null {
  const find = (k: BeatEvent['kind']) => events.find((e) => e.kind === k)

  const make = find('shotMake')
  if (make?.from) return { key, tone: 'make', segments: [{ from: make.from, to: make.to ?? BASKET, arc: 18 }] }

  const miss = find('shotMiss')
  if (miss?.from) {
    const rim = miss.to ?? BASKET
    const segments = [{ from: miss.from, to: rim, arc: 16 }]
    const rebSpot = find('rebound')?.to // stamped at grab time (survives possession reset)
    if (rebSpot) segments.push({ from: rim, to: rebSpot, arc: 6 }) // carom off the rim to the board
    return { key, tone: 'miss', segments }
  }

  const block = find('block')
  if (block?.from) return { key, tone: 'block', segments: [{ from: block.from, to: block.to ?? BASKET, arc: 9 }] }

  const steal = find('steal')
  if (steal?.from) {
    const grab = steal.to ?? steal.from // interception point, stamped at steal time
    const src = lastBallPos ?? steal.from
    return {
      key,
      tone: 'steal',
      segments: [{ from: src, to: grab, arc: 0 }],
      lane: { from: src, to: grab },
      contestId: steal.by,
    }
  }

  const turn = find('turnover')
  if (turn?.from && turn.to) {
    const src = lastBallPos ?? turn.from
    return { key, tone: 'turnover', segments: [{ from: src, to: turn.to, arc: 0 }], lane: { from: src, to: turn.to } }
  }

  const pass = find('pass')
  if (pass?.from && pass.to) {
    const src = lastBallPos ?? pass.from
    // Flag the defender nearest the pass lane — the man who could jump it.
    const offSide = players.find((p) => p.id === pass.by)?.side
    let contestId: string | undefined
    let bestD = PASS_LANE_RADIUS * 1.6
    for (const d of players) {
      if (!offSide || d.side === offSide) continue
      const laneD = distToSegment(d.pos, src, pass.to)
      if (laneD < bestD) {
        bestD = laneD
        contestId = d.id
      }
    }
    return { key, tone: 'pass', segments: [{ from: src, to: pass.to, arc: 0 }], lane: { from: src, to: pass.to }, contestId }
  }
  return null
}

/** What a queued order is still waiting on. */
type Pending =
  | null
  | { playerId: string; need: 'point'; make: (pt: Vec) => Order; hint: string; clampReach?: boolean }
  | { playerId: string; need: 'teammate' | 'enemy'; make: (id: string) => Order; hint: string; risk?: 'pass' }

/** A plan being AUTHORED for one of your players (Q46 hybrid authoring). `legs` is
 *  the full intended chain held in LOCAL state — assembled here, committed atomically
 *  with one SET_ORDER (legs[0] → order, legs[1..] → queue). There's no granular
 *  queue-edit on the engine (P1 contract): editing any link re-commits the WHOLE
 *  chain, so the UI must hold it. `mode` is the jog/sprint stance applied to the
 *  NEXT movement waypoint laid (Q13). `armScreen` makes the next floor tap drop a
 *  screen-at-spot instead of a move waypoint; `armPass` makes it drop a pass aimed
 *  at that spot (a lead a teammate runs onto). The two tools are mutually exclusive. */
type PlanDraft = { playerId: string; legs: Order[]; mode: MoveMode; armScreen: boolean; armPass: boolean }

/** Control-mode for the transport (Q48). `auto` = always-on auto-advance (a sticky
 *  Run toggle that fast-forwards through halts until you Stop or edit); `manual` =
 *  opt-in fast-forward (single-step by default, press-and-hold to run a stretch). */
type ControlMode = 'auto' | 'manual'

export default function CourtClash() {
  const game = useCourtClash()
  const { state, animating, beatMs } = game
  const onOffense = state.offense === YOU

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [plan, setPlan] = useState<PlanDraft | null>(null)
  // Default to per-step (manual) advance — you tap through one beat at a time and
  // opt into auto-run explicitly.
  const [controlMode, setControlMode] = useState<ControlMode>('manual')
  const [radial, setRadial] = useState<{ at: Vec; items: RadialItem[]; note?: string } | null>(null)
  const [flash, setFlash] = useState<{ text: string; tone: Risk | 'neutral' } | null>(null)

  const [debugOpen, setDebugOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(() => readStored(HELP_SEEN_KEY) !== '1')
  const closeHelp = useCallback(() => {
    writeStored(HELP_SEEN_KEY, '1')
    setHelpOpen(false)
  }, [])

  // -1 = coaching done; 0..n = current learn-by-doing step.
  const [coachStep, setCoachStep] = useState(() => (readStored(COACHED_KEY) === '1' ? -1 : 0))
  const finishCoach = useCallback(() => {
    writeStored(COACHED_KEY, '1')
    setCoachStep(-1)
  }, [])

  // Advance one step (shared by the bottom-bar button and the thumb-reach FAB).
  const stepDisabled = animating || state.phase !== 'play'
  const handleNextStep = useCallback(() => {
    game.runStep()
    setCoachStep((s) => {
      if (s < 0) return s
      writeStored(COACHED_KEY, '1')
      return -1
    })
  }, [game])

  const yourPlayers = useMemo(() => state.players.filter((p) => p.side === YOU), [state.players])
  const byId = useCallback((id: string | null) => state.players.find((p) => p.id === id), [state.players])
  const ballHandler = byId(state.ballHandlerId)
  const selected = byId(selectedId)

  // Clear selection/targeting whenever the possession or beat advances. An open
  // plan draft is anchored to last step's positions, so drop it too — re-author
  // against the new floor rather than committing a stale path.
  useEffect(() => {
    setSelectedId(null)
    setPending(null)
    setRadial(null)
    setPlan(null)
  }, [state.possession, state.step, state.phase])

  // First-run coach: advance from "find the ball handler" once they've actually
  // selected the handler the beat points at — a stray tap on an off-ball teammate
  // (or empty floor) leaves the intro up rather than burning it. The same tap that
  // selects the handler also opens the action bar, so hold the step-2 banner back a
  // beat: let the actions land first, then the nudge reads as the next instruction
  // rather than popping in lockstep with (and competing against) the bar.
  useEffect(() => {
    if (coachStep !== 0 || !selectedId || selectedId !== state.ballHandlerId) return
    const t = window.setTimeout(() => setCoachStep(1), 450)
    return () => window.clearTimeout(t)
  }, [coachStep, selectedId, state.ballHandlerId])

  // Surface the latest beat event as a brief flash.
  useEffect(() => {
    const ev = state.events[state.events.length - 1]
    if (!ev) return
    const tone: Risk | 'neutral' =
      ev.kind === 'shotMake'
        ? 'good'
        : ev.kind === 'stall'
          ? 'fair' // a slowed drive is a contest, not a turnover — amber, not red
          : ev.kind === 'block' || ev.kind === 'steal' || ev.kind === 'turnover' || ev.kind === 'shotclock'
            ? 'bad'
            : 'neutral'
    const text = ev.kind === 'shotMake' ? `+${ev.points}!` : ev.text
    setFlash({ text, tone })
    // The stall cue is a quick "you got bottled up" nudge — clear it fast so it
    // doesn't sit over the next drag; scores/turnovers linger a touch longer.
    const t = window.setTimeout(() => setFlash(null), ev.kind === 'stall' ? 750 : 1100)
    return () => window.clearTimeout(t)
  }, [state.events])

  // Where the live ball token sat last step (null when it wasn't in flight). A
  // multi-step pass shows step-by-step as that token, so its resolution leg flies
  // from here, not the original release point (deriveBallFlight). Updated after
  // each step settles.
  const lastBallPos = useRef<Vec | null>(null)

  // The ball's flight for the resolution step just resolved (catch/shot/rebound/
  // steal), fed to the court to animate the ball arriving. Only shown while the
  // step glides.
  const ballFlight = useMemo(
    () => deriveBallFlight(state.events, state.players, `${state.possession}-${state.step}`, lastBallPos.current),
    [state.events, state.players, state.possession, state.step],
  )

  useEffect(() => {
    lastBallPos.current = state.ball ? { ...state.ball.pos } : null
  }, [state.ball, state.step, state.possession])

  // --- Risk glow inputs ----------------------------------------------------
  const shooterRisk: Risk | null = useMemo(() => {
    if (!onOffense || !ballHandler || ballHandler.side !== YOU) return null
    return riskOf(shotMakeChance(state.players, ballHandler))
  }, [onOffense, ballHandler, state.players])

  const targetable = useMemo(() => {
    const set = new Set<string>()
    if (!pending) return set
    if (pending.need === 'teammate') yourPlayers.forEach((p) => p.id !== pending.playerId && set.add(p.id))
    else if (pending.need === 'enemy') state.players.forEach((p) => p.side !== YOU && set.add(p.id))
    return set
  }, [pending, yourPlayers, state.players])

  const targetRisk = useMemo(() => {
    const map: Record<string, Risk> = {}
    if (pending?.need === 'teammate' && pending.risk === 'pass') {
      const passer = byId(pending.playerId)
      if (passer) {
        for (const mate of yourPlayers) {
          if (mate.id === passer.id) continue
          const { p } = passStealChance(state.players, passer, mate)
          map[mate.id] = riskOf(1 - p)
        }
      }
    }
    return map
  }, [pending, byId, yourPlayers, state.players])

  // Clamp a destination to one beat's reach from the player's current spot.
  const reachClamp = (playerId: string, to: Vec, burst = false): Vec => {
    const p = byId(playerId)
    return p ? stepToward(p.pos, to, reachOf(p, burst)) : to
  }

  // Is a spot reachable in one beat? Used to decide whether a drag is ambiguous
  // (a shot/pass that could also be a move/drive — show both in the radial).
  const withinReach = (playerId: string, pt: Vec, burst = false): boolean => {
    const p = byId(playerId)
    return !!p && dist(p.pos, pt) <= reachOf(p, burst) + 0.01
  }

  // The teammate a drag-to-spot leads, and whether they can actually gather it
  // there this beat. Picks whoever comes closest to the aimed catch point (their
  // route step + a gather stride — see leadCatch). `catchable` false means the
  // aim sails past everyone's reach, so the pass would be a turnover: still
  // offered, just flagged risky. This lets you lead anywhere along a cutter's
  // lane (not just near their current spot) — or chuck it into space and pay.
  const bestLeadTarget = (handlerId: string, at: Vec): { mover: Player; catchable: boolean } | null => {
    let best: Player | null = null
    let bestMiss = Infinity
    for (const m of yourPlayers) {
      if (m.id === handlerId) continue
      const { miss } = leadCatch(m, at)
      if (miss < bestMiss) {
        bestMiss = miss
        best = m
      }
    }
    return best ? { mover: best, catchable: bestMiss <= LEAD_CATCH_RADIUS } : null
  }

  // A radial entry that pulls the trigger on a shot (not a queued order).
  const shootItem = (id: string): RadialItem => ({
    label: 'Shoot',
    icon: '🏀',
    run: () => {
      game.callShot(id)
      setSelectedId(null)
      setPending(null)
      setRadial(null)
    },
  })

  // A pick "for" a teammate: a screen is a spot on the floor (like a pass), not a
  // body to chase. We seed the spot at the defender guarding that teammate — the
  // place a pick does the most good — but it stays planted there; it doesn't track
  // the man if he moves. Falls back to the teammate's spot if no defender is near.
  const screenFor = (mateId: string): Order => {
    const mate = byId(mateId)
    const def = mate ? nearestOpponent(state.players, mate) : null
    const at = def?.pos ?? mate?.pos ?? BASKET
    return { kind: 'screen', to: { ...at } }
  }

  // --- Interaction ---------------------------------------------------------
  // Any hands-on edit pauses an in-progress auto-run (Q48 drag-to-edit interrupt):
  // you took the wheel, so the floor stops fast-forwarding until you advance again.
  const interrupt = useCallback(() => {
    if (game.autoRunning) game.stopAutoRun()
  }, [game])

  const issue = (playerId: string, order: Order) => {
    interrupt()
    game.setOrder(playerId, order)
    setSelectedId(null)
    setPending(null)
    setRadial(null)
  }

  // --- Plan authoring (Q46) ------------------------------------------------
  // The horizon a chain can hold right now: the shot-clock cap (Q45, the engine
  // clamps `queue` to MAX_QUEUE) AND what's left on the live clock — a plan can't
  // outlast the possession. legs = order + queue, so +1 over the queue cap.
  const planCap = Math.min(MAX_QUEUE + 1, Math.max(1, state.shotClock))
  // Open the authoring floater for a player, seeded with `legs` (empty for a fresh
  // plan, [firstLeg] from a drag, or [order, ...queue] to EDIT an existing plan).
  const startPlan = (playerId: string, legs: Order[] = []) => {
    interrupt()
    const first = legs[0]
    setPlan({ playerId, legs, mode: first && first.kind === 'move' ? first.mode : 'jog', armScreen: false, armPass: false })
    setSelectedId(playerId)
    setPending(null)
    setRadial(null)
  }
  // Commit the current draft (if it laid anything) and immediately open authoring on
  // another teammate — the "tap a teammate to chain plays" gesture (replaces the old
  // tap-to-pass). Lets you lay one player's route, drop a pass spot, then jump to the
  // cutter and route them onto it, all without leaving planning.
  const commitAndSwitch = (toId: string) => {
    if (plan && plan.legs.length > 0) {
      interrupt()
      const [first, ...rest] = plan.legs
      game.setOrder(plan.playerId, first, rest)
    }
    const tp = byId(toId)
    if (tp && tp.queue.length > 0) startPlan(toId, [tp.order, ...tp.queue])
    else startPlan(toId)
  }
  // Jog/Sprint also RE-TAGS the last move leg (so "drop a waypoint, then pick its
  // speed" works), and sets the stance for the next one.
  const setPlanMode = (m: MoveMode) =>
    setPlan((pl) => {
      if (!pl) return pl
      const legs = pl.legs.slice()
      const last = legs[legs.length - 1]
      if (last && last.kind === 'move') legs[legs.length - 1] = { ...last, mode: m }
      return { ...pl, mode: m, legs }
    })
  const armScreen = () => setPlan((pl) => (pl ? { ...pl, armScreen: !pl.armScreen, armPass: false } : pl))
  const armPassTool = () => setPlan((pl) => (pl ? { ...pl, armPass: !pl.armPass, armScreen: false } : pl))
  const undoLeg = () => setPlan((pl) => (pl ? { ...pl, legs: pl.legs.slice(0, -1) } : pl))
  const commitPlan = () => {
    if (!plan || plan.legs.length === 0) return
    interrupt()
    const [first, ...rest] = plan.legs
    // One atomic commit of the WHOLE intended (order, queue) — rest=[] clears any
    // stale chain (the P1 contract: no granular queue edit; re-commit the whole).
    game.setOrder(plan.playerId, first, rest)
    setPlan(null)
    setSelectedId(null)
  }
  const cancelPlan = () => {
    setPlan(null)
    setSelectedId(null)
  }

  const onPlayerTap = (id: string) => {
    const p = byId(id)
    if (!p) return
    // While authoring a plan, tapping a DIFFERENT teammate commits the current plan
    // and switches to authoring theirs — chaining plays without leaving planning.
    // Passes are spot-based now (the 🎯 tool + a floor tap), not a teammate tap;
    // screens likewise (the 🧱 tool + a floor tap).
    if (plan) {
      if (p.side === YOU && id !== plan.playerId) commitAndSwitch(id)
      return
    }
    if (pending) {
      if (pending.need === 'teammate' && targetable.has(id)) issue(pending.playerId, pending.make(id))
      else if (pending.need === 'enemy' && targetable.has(id)) issue(pending.playerId, pending.make(id))
      return
    }
    // Tapping one of YOUR players who already has a queued plan re-opens the floater
    // on that plan (loaded as order+queue) so you can edit and re-commit it — the P1
    // contract has no granular queue edit, so editing = re-committing the whole chain.
    if (p.side === YOU && p.queue.length > 0) {
      startPlan(id, [p.order, ...p.queue])
      return
    }
    // Tap any player to inspect/order them. When sprites overlap, repeated taps
    // on the same spot cycle through the stack so a buried player is reachable.
    const stack = state.players
      .filter((q) => dist(q.pos, p.pos) <= STACK_RADIUS)
      .sort((a, b) => a.id.localeCompare(b.id))
    setSelectedId((cur) => {
      if (stack.length <= 1) return cur === p.id ? null : p.id
      const idx = stack.findIndex((q) => q.id === cur)
      return idx === -1 ? p.id : stack[(idx + 1) % stack.length].id
    })
  }

  const onCourtTap = (pt: Vec) => {
    // Laying the path: each tap drops the next waypoint (NOT clamped to one step — a
    // planned chain spans the possession; the player moves toward each target then
    // holds, Q12). With the 🧱 Screen tool armed the tap drops a screen-at-spot
    // instead; otherwise a move at the draft's current jog/sprint stance.
    if (plan) {
      setPlan((pl) => {
        if (!pl || pl.legs.length >= planCap) return pl && (pl.armScreen || pl.armPass) ? { ...pl, armScreen: false, armPass: false } : pl
        const leg: Order = pl.armScreen
          ? { kind: 'screen', to: pt }
          : pl.armPass
            ? { kind: 'pass', lead: pt }
            : { kind: 'move', to: pt, mode: pl.mode }
        return { ...pl, legs: [...pl.legs, leg], armScreen: false, armPass: false }
      })
      return
    }
    if (pending?.need === 'point') {
      const dest = pending.clampReach ? reachClamp(pending.playerId, pt) : pt
      issue(pending.playerId, pending.make(dest))
      return
    }
    setSelectedId(null)
  }

  // Drag-release opens a radial of the actions that fit the drop target: drop
  // onto a player for pass/screen/guard/etc., or on a spot for move/screen/sprint.
  // One sensible action (Move/Sprint) is the primary; a lone action just
  // fires (drag-to-teammate passes instantly, drag-to-floor on defense moves).
  const onDragRelease = (id: string, at: Vec, targetId: string | null) => {
    const p = byId(id)
    if (!p || p.side !== YOU) {
      setRadial(null)
      return
    }
    const target0 = byId(targetId)
    const isHandler0 = id === state.ballHandlerId
    const onEnemy0 = !!target0 && target0.side !== YOU
    const onTeammate0 = !!target0 && target0.side === YOU && target0.id !== id
    const onHoop0 = onOffense && isHandler0 && dist(at, BASKET) <= HOOP_HIT

    // Already authoring? A drag on the planned player EXTENDS the path — drop a
    // waypoint (or a screen if the tool is armed) at the release point. Drags on
    // anyone else are ignored mid-plan.
    if (plan) {
      if (id === plan.playerId) {
        setPlan((pl) => {
          if (!pl || pl.legs.length >= planCap) return pl
          const leg: Order = pl.armScreen
            ? { kind: 'screen', to: at }
            : pl.armPass
              ? { kind: 'pass', lead: at }
              : { kind: 'move', to: at, mode: pl.mode }
          return { ...pl, legs: [...pl.legs, leg], armScreen: false, armPass: false }
        })
      }
      setRadial(null)
      return
    }

    // DRAG = LAY A PLAN (Q46 entry). A drag on one of your players starts a chain,
    // the drag laying the first leg — so planning is one gesture, no tap-then-Plan.
    // The two NON-route gestures stay one-shots (not a path): the handler shooting
    // at the rim, and a drop onto an enemy (offense drive-at / defense
    // guard·double·steal) — those keep the contextual radial below.
    if (!onHoop0 && !onEnemy0) {
      const first: Order = onTeammate0 && isHandler0 ? { kind: 'pass', toId: target0!.id } : { kind: 'move', to: at, mode: 'jog' }
      // Already has a plan? Append the new leg to it rather than discarding it.
      if (p.queue.length > 0) startPlan(id, [p.order, ...p.queue, first])
      else startPlan(id, [first])
      return
    }

    const spot = reachClamp(id, at)
    const burstSpot = reachClamp(id, at, true) // drives/cuts reach the outer ring
    // Sprint is always on the table next to Move — except when the player is so
    // gassed the engine would collapse the burst to a jog anyway (below the
    // sprint floor). Otherwise the speed choice silently disappears on some drop
    // targets, which reads as a bug.
    const canSprint = p.stamina >= SPRINT_FLOOR
    const target = byId(targetId)
    const onTeammate = !!target && target.side === YOU && target.id !== id
    const onEnemy = !!target && target.side !== YOU
    const mk = (label: string, icon: string, order: Order): RadialItem => ({
      label,
      icon,
      run: () => issue(id, order),
    })
    const items: RadialItem[] = []
    // A one-line caption explaining the offered actions in-context (e.g. the
    // difference between a lead pass and a risky pass), shown under the menu.
    let note: string | undefined

    if (onOffense) {
      const isHandler = id === state.ballHandlerId
      const onHoop = isHandler && dist(at, BASKET) <= HOOP_HIT
      const lead = isHandler ? bestLeadTarget(id, at) : null
      if (onHoop) {
        // Drag the handler onto the rim to shoot — but always also offer to
        // attack the basket (clamped to reach) so you're never forced into a
        // shot when you meant to drive there. If a cutter is breaking to the
        // rim, you can lead them with the pass instead (only when it's a catch —
        // no risky throws cluttering the shoot menu).
        items.push(shootItem(id))
        if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'drive', to: reachClamp(id, BASKET, true) }))
        if (lead?.catchable) {
          items.push(mk('Lead pass', '🎯', { kind: 'pass', toId: lead.mover.id, lead: at }))
          note = '🎯 Lead pass — drops it ahead of a cutter to catch in stride.'
        }
      } else if (onTeammate && target) {
        if (isHandler) {
          items.push(mk('Pass', '🤝', { kind: 'pass', toId: target.id }))
          // If that teammate is within reach, you might mean to relocate, not pass.
          if (withinReach(id, target.pos)) {
            items.push(mk('Move', '👟', { kind: 'move', to: reachClamp(id, target.pos), mode: 'jog' }))
            if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'drive', to: reachClamp(id, target.pos, true) }))
          }
        } else {
          // Drop onto a teammate to set a pick FOR them — seeds a screen at the
          // spot of the defender guarding them (a fixed pick, not a chased body).
          items.push(mk('Screen', '🧱', screenFor(target.id)))
          items.push(mk('Move', '👟', { kind: 'move', to: reachClamp(id, target.pos), mode: 'jog' }))
          if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'cut', to: reachClamp(id, target.pos, true) }))
        }
      } else if (onEnemy && target) {
        if (isHandler) {
          if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'drive', to: reachClamp(id, target.pos, true) }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
        } else {
          // Drop onto a defender to set a screen at his spot — a fixed pick on
          // the floor (like a pass), not a body to chase if he moves off it.
          items.push(mk('Screen', '🧱', { kind: 'screen', to: { ...target.pos } }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
          if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'cut', to: burstSpot }))
        }
      } else if (isHandler) {
        // Aiming at open floor: lead a teammate breaking toward here with a pass
        // — a clean catch if someone can gather it in stride, a flagged "risky"
        // throw if it sails past everyone (a likely turnover). Either way the
        // handler's own drive/move stay on the menu.
        if (lead) {
          if (lead.catchable) {
            items.push(mk('Lead pass', '🎯', { kind: 'pass', toId: lead.mover.id, lead: at }))
            note = '🎯 Lead pass — drops it ahead of a cutter to catch in stride.'
          } else {
            items.push(mk('Risky pass', '🎲', { kind: 'pass', toId: lead.mover.id, lead: at }))
            note = '🎲 Risky pass — no teammate can reach this spot; likely a turnover.'
          }
        }
        if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'drive', to: burstSpot }))
        items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
      } else {
        items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
        items.push(mk('Screen', '🧱', { kind: 'screen', to: spot }))
        if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'cut', to: burstSpot }))
      }
    } else if (onEnemy && target) {
      items.push(mk('Guard', '🛡️', { kind: 'guard', markId: target.id }))
      items.push(mk('Double', '👥', { kind: 'double', markId: target.id }))
      items.push(mk('Steal', '🖐️', { kind: 'steal', markId: target.id }))
    } else {
      items.push(mk('Move', '👟', { kind: 'help', to: spot }))
      if (canSprint) items.push(mk('Sprint', '⚡', { kind: 'help', to: spot, mode: 'sprint' }))
    }

    if (items.length === 0) {
      setRadial(null)
      return
    }
    // Always surface the menu rather than auto-firing a lone action — so a drag
    // always lets you choose (e.g. shoot vs. sprint to the rim), never commits a
    // shot behind your back.
    setRadial({ at, items, note })
  }

  const onRadialCancel = () => setRadial(null)

  // --- Action menu for the selected player --------------------------------
  const actions = useMemo(() => {
    if (!selected || selected.side !== YOU) return []
    const id = selected.id
    // `mode` tags movement actions slow-nimble (jog) vs fast-committed (sprint) so
    // the central decision is legible on the buttons, not just buried in Help.
    // Sprint drops off the menu only when the player is too gassed to honor it
    // (mirrors the drag radial — see onDragRelease).
    const canSprint = selected.stamina >= SPRINT_FLOOR
    const list: { label: string; run: () => void; sub?: string; mode?: 'jog' | 'sprint' }[] = []
    if (onOffense) {
      if (id === state.ballHandlerId) {
        list.push({ label: '🏀 Shoot', run: () => game.callShot(id) })
        list.push({
          label: 'Pass →',
          run: () => setPending({ playerId: id, need: 'teammate', make: (t) => ({ kind: 'pass', toId: t }), hint: 'Pick a teammate to pass to.', risk: 'pass' }),
        })
        if (canSprint) list.push({ label: 'Sprint', sub: 'fast, committed', mode: 'sprint', run: () => issue(id, { kind: 'drive', to: reachClamp(id, BASKET, true) }) })
      } else {
        if (canSprint) list.push({ label: 'Sprint', sub: 'fast, committed', mode: 'sprint', run: () => issue(id, { kind: 'cut', to: reachClamp(id, BASKET, true) }) })
        list.push({
          label: 'Move →',
          sub: 'slow, nimble',
          mode: 'jog',
          run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'move', to: pt, mode: 'jog' }), hint: 'Tap a spot within reach.', clampReach: true }),
        })
        list.push({
          label: 'Screen →',
          run: () =>
            setPending({
              playerId: id,
              need: 'point',
              make: (pt) => ({ kind: 'screen', to: pt }),
              hint: 'Tap a spot on the court to set a screen there.',
            }),
        })
        list.push({ label: 'Hold (rest)', run: () => issue(id, { kind: 'idle' }) })
      }
    } else {
      list.push({
        label: 'Guard →',
        run: () => setPending({ playerId: id, need: 'enemy', make: (m) => ({ kind: 'guard', markId: m }), hint: 'Pick the man to guard (switch).' }),
      })
      if (state.ballHandlerId) {
        list.push({ label: 'Double', run: () => issue(id, { kind: 'double', markId: state.ballHandlerId! }) })
        list.push({ label: 'Steal', run: () => issue(id, { kind: 'steal', markId: state.ballHandlerId! }) })
      }
      list.push({
        label: 'Move →',
        sub: 'slow, nimble',
        mode: 'jog',
        run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'help', to: pt }), hint: 'Tap a spot within reach.', clampReach: true }),
      })
      if (canSprint) {
        list.push({
          label: 'Sprint →',
          sub: 'fast, committed cutoff',
          mode: 'sprint',
          run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'help', to: pt, mode: 'sprint' }), hint: 'Tap a spot to sprint and cut off.', clampReach: true }),
        })
      }
    }
    // Hybrid authoring entry (Q46): chain a multi-step plan for this player —
    // available to both sides (a planned cut/relocation chain, or a defensive
    // rotation path), committed atomically as (order, queue).
    list.push({ label: '📋 Plan chain', sub: 'multi-step', run: () => startPlan(id) })
    return list
  }, [selected, onOffense, state.ballHandlerId, game])

  const hint = plan
    ? `📋 Planning ${byId(plan.playerId)?.name ?? ''} — tap the floor for waypoints, 🎯/🧱 then a spot to pass/screen, or tap a teammate to commit & plan theirs.`
    : pending
      ? pending.hint
      : selected
        ? `${selected.name} (${selected.role}) — pick an action.`
        : onOffense
          ? 'Your ball. Drag the handler onto the hoop to shoot, or onto a spot/teammate to move/pass — then ▶ Next Step.'
          : "Defense. Drag one of your players onto the CPU's ball handler to guard, double, or steal — then ▶ Next Step."

  // --- Transport / control modes (Q48) -------------------------------------
  const autoRunning = game.autoRunning
  // Auto-run only makes sense when there's a committed plan still in flight. On
  // OFFENSE, gate it on at least one of your players having UNFINISHED motion — a
  // non-empty queue OR an active order that hasn't arrived yet. Keying off the queue
  // alone stopped auto-run one leg early: the final leg empties the queue the moment
  // it's promoted to the active order, so the loop quit while the handler was still
  // gliding to the last spot (and couldn't restart). Including the in-progress order
  // carries the fast-forward through to arrival. On defense it's still allowed (you
  // may want to fast-forward through the AI's possession).
  const yourHavePlan = useMemo(
    () => yourPlayers.some((p) => p.queue.length > 0 || !orderDone(p.order, p)),
    [yourPlayers],
  )
  const canAutoRun = !onOffense || yourHavePlan
  // If the queues drain mid-run (or possession flips) while on offense, stop.
  useEffect(() => {
    if (autoRunning && !canAutoRun) game.stopAutoRun()
  }, [autoRunning, canAutoRun, game])

  const stepNow = () => {
    interrupt()
    handleNextStep()
  }
  const toggleAuto = () => (autoRunning ? game.stopAutoRun() : canAutoRun && game.startAutoRun())
  const switchMode = (m: ControlMode) => {
    if (m === controlMode) return
    game.stopAutoRun()
    setControlMode(m)
  }
  // The bottom-right FAB mirrors the mode's main advance: Stop while running, else
  // start the auto-run (auto mode) or take one step (manual).
  const onFab = () => {
    if (autoRunning) return game.stopAutoRun()
    if (controlMode === 'auto') {
      if (canAutoRun) game.startAutoRun()
    } else stepNow()
  }

  // A draft leg's glyph for the chain-preview chips.
  const legIcon = (o: Order): string => {
    switch (o.kind) {
      case 'pass':
        return '🎯'
      case 'screen':
        return '🧱'
      case 'idle':
        return '⏸'
      case 'cut':
      case 'drive':
        return '⚡'
      case 'move':
        return o.mode === 'sprint' ? '⚡' : '👟'
      default:
        return '•'
    }
  }

  return (
    <div className="cc">
      <header className="cc__header">
        <a className="cc__back" href="#/">
          ← Games
        </a>
        <h1 className="cc__title">Court Clash</h1>
        <div className="cc__header-actions">
          <button type="button" className="cc-btn cc-btn--icon" onClick={() => setHelpOpen(true)} aria-label="How to play">
            ?
          </button>
          <button type="button" className="cc-btn cc-btn--icon" onClick={() => setDebugOpen(true)} aria-label="Debug log">
            🐞
          </button>
          <button type="button" className="cc-btn" onClick={game.newGame}>
            New Game
          </button>
        </div>
      </header>

      <div className="cc__scoreboard">
        <div className={`cc__score ${onOffense ? 'cc__score--live' : ''}`}>
          <span className="cc__score-label">YOU</span>
          <span className="cc__score-num">{state.score.player}</span>
        </div>
        <div className="cc__center">
          <div className="cc__possession">{onOffense ? '◀ OFFENSE' : 'DEFENSE ▶'}</div>
          <div className="cc__shotclock-cap">shot clock · steps</div>
          <div className={`cc__shotclock ${state.shotClock <= 3 ? 'cc__shotclock--warn' : ''}`} aria-label={`Shot clock: ${state.shotClock} steps`}>
            {String(state.shotClock).padStart(2, '0')}
          </div>
          <div className="cc__meta">
            <span className="cc__step" aria-label={`Step ${state.step}`}>step {state.step}</span>
            <span className="cc__to">first to {WIN_TARGET}</span>
          </div>
        </div>
        <div className={`cc__score ${!onOffense ? 'cc__score--live' : ''}`}>
          <span className="cc__score-label">CPU</span>
          <span className="cc__score-num">{state.score.ai}</span>
        </div>
      </div>

      {coachStep >= 0 && state.phase === 'play' && (
        <div className="cc__coach" role="status">
          <span className="cc__coach-text">{COACH_STEPS[coachStep]}</span>
          <button type="button" className="cc__coach-x" onClick={finishCoach} aria-label="Dismiss tips">
            Got it ✕
          </button>
        </div>
      )}

      <p className={`cc__hint ${pending ? 'cc__hint--active' : ''}`}>{hint}</p>

      <Court
        players={state.players}
        ballHandlerId={state.ballHandlerId}
        yourSide={YOU}
        selectedId={selectedId}
        targetable={targetable}
        targetRisk={targetRisk}
        shooterRisk={shooterRisk}
        animating={animating}
        beatMs={beatMs}
        flash={flash}
        ballFlight={animating ? ballFlight : null}
        ball={state.ball}
        gather={state.gather}
        radial={radial}
        handlerCue={onOffense && coachStep >= 0 && !selectedId}
        draft={plan}
        planUI={
          plan
            ? {
                mode: plan.mode,
                count: plan.legs.length,
                screenArmed: plan.armScreen,
                passArmed: plan.armPass,
                onMode: setPlanMode,
                onScreen: armScreen,
                onPass: armPassTool,
                onUndo: undoLeg,
                onCommit: commitPlan,
                onCancel: cancelPlan,
              }
            : null
        }
        onPlayerTap={onPlayerTap}
        onCourtTap={onCourtTap}
        onDragRelease={onDragRelease}
        onRadialCancel={onRadialCancel}
        onInterrupt={interrupt}
      />

      {selected && <AttrPanel player={selected} />}

      <div className="cc__bar">
        {plan ? (
          // --- Plan preview (Q46). The controls live in the on-court floating menu
          // (thumb stays on the floor); this is the chain readout + capacity. ---
          <div className="cc__plan">
            <span className="cc__plan-hint">
              {plan.armScreen
                ? '🧱 Tap a spot to set a screen there'
                : plan.armPass
                  ? '🎯 Tap a spot to pass there — a teammate runs onto it'
                  : '📋 Tap the floor for waypoints · drag to extend · tap a teammate to commit & plan theirs'}
            </span>
            <div className="cc__plan-chain" aria-label={`${plan.legs.length} steps planned`}>
              {plan.legs.length === 0 ? (
                <span className="cc__plan-empty">No waypoints yet…</span>
              ) : (
                plan.legs.map((o, i) => (
                  <span key={i} className={`cc__plan-chip${o.kind === 'move' && o.mode === 'sprint' ? ' cc__plan-chip--sprint' : ''}`} title={o.kind}>
                    <span className="cc__plan-chip-n">{i + 1}</span>
                    {legIcon(o)}
                  </span>
                ))
              )}
              <span className="cc__plan-cap">
                {plan.legs.length}/{planCap}
              </span>
            </div>
          </div>
        ) : pending ? (
          <button type="button" className="cc-btn" onClick={() => setPending(null)}>
            ✕ Cancel
          </button>
        ) : selected && selected.side === YOU ? (
          <div className="cc__actions">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`cc-btn cc-btn--action${a.mode ? ` cc-btn--${a.mode}` : ''}`}
                onClick={a.run}
              >
                <span className="cc-action__label">{a.label}</span>
                {a.sub && <span className="cc-action__sub">{a.sub}</span>}
              </button>
            ))}
          </div>
        ) : selected ? (
          <span className="cc__bar-tip">Scouting {selected.name} — tap your own players to give orders.</span>
        ) : (
          <span className="cc__bar-tip">Tap a player to give orders or scout their attributes.</span>
        )}
        <div className="cc__transport">
          {/* Control-mode toggle (Q48): auto-advance (sticky Run) vs manual (step +
              press-hold fast-forward). */}
          <div className="cc__modeseg" role="group" aria-label="Control mode">
            <button type="button" className={`cc-seg${controlMode === 'auto' ? ' cc-seg--on' : ''}`} onClick={() => switchMode('auto')}>
              Auto
            </button>
            <button type="button" className={`cc-seg${controlMode === 'manual' ? ' cc-seg--on' : ''}`} onClick={() => switchMode('manual')}>
              Manual
            </button>
          </div>
          <label className="cc__halt" title="Also pause the auto-run on scores, turnovers & possession changes">
            <input
              type="checkbox"
              checked={state.haltOnSalient.player}
              onChange={(e) => game.setHaltPolicy(YOU, e.target.checked)}
            />
            <span>⏸ big plays</span>
          </label>
          {controlMode === 'auto' ? (
            <button
              type="button"
              className={`cc-btn cc-btn--primary cc__run${autoRunning ? ' cc__run--stop' : ''}`}
              onClick={toggleAuto}
              disabled={state.phase !== 'play' || (!autoRunning && !canAutoRun)}
              title={!canAutoRun ? 'Queue a multi-step plan first (drag a player) to auto-run' : undefined}
            >
              {autoRunning ? '⏹ Stop' : '▶ Auto-run'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="cc-btn cc__ff"
                onPointerDown={(e) => {
                  e.preventDefault()
                  if (canAutoRun) game.startAutoRun()
                }}
                onPointerUp={game.stopAutoRun}
                onPointerLeave={game.stopAutoRun}
                onPointerCancel={game.stopAutoRun}
                disabled={state.phase !== 'play' || !canAutoRun}
                title={!canAutoRun ? 'Queue a multi-step plan first (drag a player) to fast-forward' : undefined}
                aria-label="Hold to fast-forward"
              >
                ⏩ FF
              </button>
              <button type="button" className="cc-btn cc-btn--primary cc__run" onClick={stepNow} disabled={stepDisabled}>
                ▶ Next Step
              </button>
            </>
          )}
        </div>
      </div>

      {/* Thumb-reach Next-Step FAB (mobile): the drag→radial→bottom-bar loop made
          the thumb cross the whole viewport each step. A bottom-right floater keeps
          the most-used control in reach. Mirrors the bar button; hidden on wide
          screens via CSS. */}
      {state.phase === 'play' && (
        <button
          type="button"
          className={`cc__fab${radial || plan ? ' cc__fab--hidden' : ''}${autoRunning ? ' cc__fab--stop' : ''}`}
          onClick={onFab}
          disabled={!autoRunning && (stepDisabled || (controlMode === 'auto' && !canAutoRun))}
          aria-label={autoRunning ? 'Stop auto-run' : controlMode === 'auto' ? 'Auto-run' : 'Next step'}
        >
          {autoRunning ? '⏹' : '▶'}
        </button>
      )}

      <GameLog lines={state.log} />

      {debugOpen && <DebugPanel getLog={game.getDebug} onClose={() => setDebugOpen(false)} />}
      {helpOpen && <HelpModal onClose={closeHelp} />}
      {state.phase === 'gameover' && state.winner && (
        <GameOverModal winner={state.winner} playerScore={state.score.player} aiScore={state.score.ai} onNewGame={game.newGame} />
      )}
    </div>
  )
}
