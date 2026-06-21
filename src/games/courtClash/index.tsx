import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASKET, LEAD_CATCH_RADIUS, PASS_LANE_RADIUS, WIN_TARGET, riskOf, type Risk } from './constants'
import { passStealChance, shotMakeChance } from './engine'
import { dist, distToSegment, leadCatch, nearestOpponent, reachOf, stepToward } from './geometry'
import { useCourtClash } from './useCourtClash'
import type { BeatEvent, Order, Player, Side, Vec } from './types'
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
 *  off-ball teammate doesn't burn the intro. */
const COACH_STEPS = [
  '👋 You\'re on offense. The glowing 🏀 token is your ball handler — tap them (or drag) to give the first order.',
  '👍 Set orders for any of your five (they stick until you change them), then press ▶ Next Step to advance one step.',
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

export default function CourtClash() {
  const game = useCourtClash()
  const { state, animating, beatMs } = game
  const onOffense = state.offense === YOU

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
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

  // Clear selection/targeting whenever the possession or beat advances.
  useEffect(() => {
    setSelectedId(null)
    setPending(null)
    setRadial(null)
  }, [state.possession, state.step, state.phase])

  // First-run coach: advance from "find the ball handler" once they've actually
  // selected the handler the beat points at — a stray tap on an off-ball teammate
  // (or empty floor) leaves the intro up rather than burning it.
  useEffect(() => {
    if (coachStep === 0 && selectedId && selectedId === state.ballHandlerId) setCoachStep(1)
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

  // A pick "for" a teammate: track the man guarding them (a body, not a spot),
  // so the screener chases the defender wherever they go. Falls back to the
  // teammate's spot if no defender is nearby.
  const screenFor = (mateId: string): Order => {
    const mate = byId(mateId)
    const def = mate ? nearestOpponent(state.players, mate) : null
    if (def) return { kind: 'screen', to: { ...def.pos }, markId: def.id }
    return { kind: 'screen', to: mate ? { ...mate.pos } : { ...BASKET } }
  }

  // --- Interaction ---------------------------------------------------------
  const issue = (playerId: string, order: Order) => {
    game.setOrder(playerId, order)
    setSelectedId(null)
    setPending(null)
    setRadial(null)
  }

  const onPlayerTap = (id: string) => {
    const p = byId(id)
    if (!p) return
    if (pending) {
      if (pending.need === 'teammate' && targetable.has(id)) issue(pending.playerId, pending.make(id))
      else if (pending.need === 'enemy' && targetable.has(id)) issue(pending.playerId, pending.make(id))
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
    if (pending?.need === 'point') {
      const dest = pending.clampReach ? reachClamp(pending.playerId, pt) : pt
      issue(pending.playerId, pending.make(dest))
      return
    }
    setSelectedId(null)
  }

  // Drag-release opens a radial of the actions that fit the drop target: drop
  // onto a player for pass/screen/guard/etc., or on a spot for move/screen/cut.
  // One sensible action (Move/Drive/Help) is the primary; a lone action just
  // fires (drag-to-teammate passes instantly, drag-to-floor on defense helps).
  const onDragRelease = (id: string, at: Vec, targetId: string | null) => {
    const p = byId(id)
    if (!p || p.side !== YOU) {
      setRadial(null)
      return
    }
    const spot = reachClamp(id, at)
    const burstSpot = reachClamp(id, at, true) // drives/cuts reach the outer ring
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
        items.push(mk('Drive', '⚡', { kind: 'drive', to: reachClamp(id, BASKET, true) }))
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
          }
        } else {
          // Drop onto a teammate to set a pick FOR them (screen their defender).
          items.push(mk('Screen', '🧱', screenFor(target.id)))
          items.push(mk('Move', '👟', { kind: 'move', to: reachClamp(id, target.pos), mode: 'jog' }))
        }
      } else if (onEnemy && target) {
        if (isHandler) {
          items.push(mk('Drive', '⚡', { kind: 'drive', to: reachClamp(id, target.pos, true) }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
        } else {
          // Drop onto a defender to screen that man (track them, not the floor).
          items.push(mk('Screen', '🧱', { kind: 'screen', to: { ...target.pos }, markId: target.id }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
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
        items.push(mk('Drive', '⚡', { kind: 'drive', to: burstSpot }))
        items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
      } else {
        items.push(mk('Move', '👟', { kind: 'move', to: spot, mode: 'jog' }))
        items.push(mk('Screen', '🧱', { kind: 'screen', to: spot }))
        items.push(mk('Cut', '✂️', { kind: 'cut', to: burstSpot }))
      }
    } else if (onEnemy && target) {
      items.push(mk('Guard', '🛡️', { kind: 'guard', markId: target.id }))
      items.push(mk('Double', '👥', { kind: 'double', markId: target.id }))
      items.push(mk('Steal', '🖐️', { kind: 'steal', markId: target.id }))
    } else {
      items.push(mk('Help', '🧭', { kind: 'help', to: spot }))
    }

    if (items.length === 0) {
      setRadial(null)
      return
    }
    // Always surface the menu rather than auto-firing a lone action — so a drag
    // always lets you choose (e.g. shoot vs. drive to the rim), never commits a
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
    const list: { label: string; run: () => void; sub?: string; mode?: 'jog' | 'sprint' }[] = []
    if (onOffense) {
      if (id === state.ballHandlerId) {
        list.push({ label: '🏀 Shoot', run: () => game.callShot(id) })
        list.push({
          label: 'Pass →',
          run: () => setPending({ playerId: id, need: 'teammate', make: (t) => ({ kind: 'pass', toId: t }), hint: 'Pick a teammate to pass to.', risk: 'pass' }),
        })
        list.push({ label: 'Drive', sub: 'sprint · fast, committed', mode: 'sprint', run: () => issue(id, { kind: 'drive', to: reachClamp(id, BASKET, true) }) })
      } else {
        list.push({ label: 'Cut', sub: 'sprint · fast, committed', mode: 'sprint', run: () => issue(id, { kind: 'cut', to: reachClamp(id, BASKET, true) }) })
        list.push({
          label: 'Move →',
          sub: 'jog · slow, nimble',
          mode: 'jog',
          run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'move', to: pt, mode: 'jog' }), hint: 'Tap a spot within reach.', clampReach: true }),
        })
        list.push({
          label: 'Screen for →',
          run: () =>
            setPending({
              playerId: id,
              need: 'teammate',
              make: (mateId) => screenFor(mateId),
              hint: 'Pick the teammate to set a pick for — your screener will chase their defender.',
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
        label: 'Help →',
        run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'help', to: pt }), hint: 'Tap a spot within reach.', clampReach: true }),
      })
    }
    return list
  }, [selected, onOffense, state.ballHandlerId, game])

  const hint = pending
    ? pending.hint
    : selected
      ? `${selected.name} (${selected.role}) — pick an action.`
      : onOffense
        ? 'Your ball. Drag the handler onto the hoop to shoot, or onto a spot/teammate to move/pass — then ▶ Next Step.'
        : "Defense. Drag one of your players onto the CPU's ball handler to guard, double, or steal — then ▶ Next Step."

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
        onPlayerTap={onPlayerTap}
        onCourtTap={onCourtTap}
        onDragRelease={onDragRelease}
        onRadialCancel={onRadialCancel}
      />

      {selected && <AttrPanel player={selected} />}

      <div className="cc__bar">
        {pending ? (
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
          <button
            type="button"
            className="cc-btn cc-btn--primary cc__run"
            onClick={handleNextStep}
            disabled={stepDisabled}
          >
            ▶ Next Step
          </button>
        </div>
      </div>

      {/* Thumb-reach Next-Step FAB (mobile): the drag→radial→bottom-bar loop made
          the thumb cross the whole viewport each step. A bottom-right floater keeps
          the most-used control in reach. Mirrors the bar button; hidden on wide
          screens via CSS. */}
      {state.phase === 'play' && (
        <button
          type="button"
          className="cc__fab"
          onClick={handleNextStep}
          disabled={stepDisabled}
          aria-label="Next step"
        >
          ▶
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
