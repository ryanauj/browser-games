import { useCallback, useEffect, useMemo, useState } from 'react'
import { BASKET, WIN_TARGET, riskOf, type Risk } from './constants'
import { passStealChance, shotMakeChance } from './engine'
import { dist, nearestOpponent, reachOf, stepToward } from './geometry'
import { useCourtClash } from './useCourtClash'
import type { Order, Side, Vec } from './types'
import { AttrPanel } from './components/AttrPanel'
import { Court, HOOP_HIT, type RadialItem } from './components/Court'
import { DebugPanel } from './components/DebugPanel'
import { GameLog } from './components/GameLog'
import { GameOverModal } from './components/GameOverModal'
import { HelpModal } from './components/HelpModal'
import './courtClash.css'

const HELP_SEEN_KEY = 'courtclash-help-seen'
const COACHED_KEY = 'courtclash-coached'
/** First-run, learn-by-doing nudges — advance as the player actually acts. */
const COACH_STEPS = [
  '👋 Tap one of your players (blue) to give an order — or drag them onto a teammate or an open spot.',
  '👍 Pick an action, then press ▶ Next Beat to run it. Orders stay until you change them.',
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
  const [radial, setRadial] = useState<{ at: Vec; items: RadialItem[] } | null>(null)
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

  const yourPlayers = useMemo(() => state.players.filter((p) => p.side === YOU), [state.players])
  const byId = useCallback((id: string | null) => state.players.find((p) => p.id === id), [state.players])
  const ballHandler = byId(state.ballHandlerId)
  const selected = byId(selectedId)

  // Clear selection/targeting whenever the possession or beat advances.
  useEffect(() => {
    setSelectedId(null)
    setPending(null)
    setRadial(null)
  }, [state.possession, state.beat, state.phase])

  // First-run coach: advance from "tap a player" once they've selected one.
  useEffect(() => {
    if (coachStep === 0 && selectedId) setCoachStep(1)
  }, [coachStep, selectedId])

  // Surface the latest beat event as a brief flash.
  useEffect(() => {
    const ev = state.events[state.events.length - 1]
    if (!ev) return
    const tone: Risk | 'neutral' =
      ev.kind === 'shotMake'
        ? 'good'
        : ev.kind === 'block' || ev.kind === 'steal' || ev.kind === 'turnover' || ev.kind === 'shotclock' || ev.kind === 'stall'
          ? 'bad'
          : 'neutral'
    const text = ev.kind === 'shotMake' ? `+${ev.points}!` : ev.text
    setFlash({ text, tone })
    const t = window.setTimeout(() => setFlash(null), 1100)
    return () => window.clearTimeout(t)
  }, [state.events])

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

    if (onOffense) {
      const isHandler = id === state.ballHandlerId
      const onHoop = isHandler && dist(at, BASKET) <= HOOP_HIT
      if (onHoop) {
        // Drag the handler onto the rim to shoot — but always also offer to
        // attack the basket (clamped to reach) so you're never forced into a
        // shot when you meant to drive there.
        items.push(shootItem(id))
        items.push(mk('Drive', '⚡', { kind: 'drive', to: reachClamp(id, BASKET, true) }))
      } else if (onTeammate && target) {
        if (isHandler) {
          items.push(mk('Pass', '🤝', { kind: 'pass', toId: target.id }))
          // If that teammate is within reach, you might mean to relocate, not pass.
          if (withinReach(id, target.pos)) {
            items.push(mk('Move', '👟', { kind: 'move', to: reachClamp(id, target.pos) }))
          }
        } else {
          // Drop onto a teammate to set a pick FOR them (screen their defender).
          items.push(mk('Screen', '🧱', screenFor(target.id)))
          items.push(mk('Move', '👟', { kind: 'move', to: reachClamp(id, target.pos) }))
        }
      } else if (onEnemy && target) {
        if (isHandler) {
          items.push(mk('Drive', '⚡', { kind: 'drive', to: reachClamp(id, target.pos, true) }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot }))
        } else {
          // Drop onto a defender to screen that man (track them, not the floor).
          items.push(mk('Screen', '🧱', { kind: 'screen', to: { ...target.pos }, markId: target.id }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot }))
        }
      } else if (isHandler) {
        items.push(mk('Drive', '⚡', { kind: 'drive', to: burstSpot }))
        items.push(mk('Move', '👟', { kind: 'move', to: spot }))
      } else {
        items.push(mk('Move', '👟', { kind: 'move', to: spot }))
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
    setRadial({ at, items })
  }

  const onRadialCancel = () => setRadial(null)

  // --- Action menu for the selected player --------------------------------
  const actions = useMemo(() => {
    if (!selected || selected.side !== YOU) return []
    const id = selected.id
    const list: { label: string; run: () => void }[] = []
    if (onOffense) {
      if (id === state.ballHandlerId) {
        list.push({ label: '🏀 Shoot', run: () => game.callShot(id) })
        list.push({
          label: 'Pass →',
          run: () => setPending({ playerId: id, need: 'teammate', make: (t) => ({ kind: 'pass', toId: t }), hint: 'Pick a teammate to pass to.', risk: 'pass' }),
        })
        list.push({ label: 'Drive', run: () => issue(id, { kind: 'drive', to: reachClamp(id, BASKET, true) }) })
      } else {
        list.push({ label: 'Cut', run: () => issue(id, { kind: 'cut', to: reachClamp(id, BASKET, true) }) })
        list.push({
          label: 'Move →',
          run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'move', to: pt }), hint: 'Tap a spot within reach.', clampReach: true }),
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
        ? 'Your ball. Drag the handler onto the hoop to shoot, or onto a spot/teammate to move/pass — then ▶ Next Beat.'
        : "Defense. Drag one of your players onto the CPU's ball handler to guard, double, or steal — then ▶ Next Beat."

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
          <div className="cc__shotclock-cap">shot clock · beats</div>
          <div className={`cc__shotclock ${state.shotClock <= 3 ? 'cc__shotclock--warn' : ''}`} aria-label={`Shot clock: ${state.shotClock} beats`}>
            {String(state.shotClock).padStart(2, '0')}
          </div>
          <div className="cc__to">first to {WIN_TARGET}</div>
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
        radial={radial}
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
              <button key={a.label} type="button" className="cc-btn cc-btn--action" onClick={a.run}>
                {a.label}
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
            onClick={() => {
              game.runBeat()
              if (coachStep >= 0) finishCoach()
            }}
            disabled={animating || state.phase !== 'play'}
          >
            ▶ Next Beat
          </button>
        </div>
      </div>

      <GameLog lines={state.log} />

      {debugOpen && <DebugPanel getLog={game.getDebug} onClose={() => setDebugOpen(false)} />}
      {helpOpen && <HelpModal onClose={closeHelp} />}
      {state.phase === 'gameover' && state.winner && (
        <GameOverModal winner={state.winner} playerScore={state.score.player} aiScore={state.score.ai} onNewGame={game.newGame} />
      )}
    </div>
  )
}
