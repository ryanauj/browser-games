import { useCallback, useEffect, useMemo, useState } from 'react'
import { BASKET, WIN_TARGET, riskOf, type Risk } from './constants'
import { passStealChance, shotMakeChance } from './engine'
import { dist, reachOf, stepToward } from './geometry'
import { useCourtClash } from './useCourtClash'
import type { Order, Side, Vec } from './types'
import { AttrPanel } from './components/AttrPanel'
import { Court, type RadialItem } from './components/Court'
import { DebugPanel } from './components/DebugPanel'
import { GameLog } from './components/GameLog'
import { GameOverModal } from './components/GameOverModal'
import { HelpModal } from './components/HelpModal'
import './courtClash.css'

const HELP_SEEN_KEY = 'courtclash-help-seen'
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
  const { state, animating } = game
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

  // Surface the latest beat event as a brief flash.
  useEffect(() => {
    const ev = state.events[state.events.length - 1]
    if (!ev) return
    const tone: Risk | 'neutral' =
      ev.kind === 'shotMake'
        ? 'good'
        : ev.kind === 'block' || ev.kind === 'steal' || ev.kind === 'turnover' || ev.kind === 'shotclock'
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
      if (onTeammate && target) {
        const to = reachClamp(id, target.pos)
        if (isHandler) items.push(mk('Pass', '🤝', { kind: 'pass', toId: target.id }))
        else {
          items.push(mk('Screen', '🧱', { kind: 'screen', to }))
          items.push(mk('Move', '👟', { kind: 'move', to }))
        }
      } else if (onEnemy && target) {
        if (isHandler) {
          items.push(mk('Drive', '⚡', { kind: 'drive', to: reachClamp(id, target.pos, true) }))
          items.push(mk('Move', '👟', { kind: 'move', to: spot }))
        } else {
          items.push(mk('Screen', '🧱', { kind: 'screen', to: reachClamp(id, target.pos) }))
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
    if (items.length === 1) {
      items[0].run()
      return
    }
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
          label: 'Screen →',
          run: () => setPending({ playerId: id, need: 'point', make: (pt) => ({ kind: 'screen', to: pt }), hint: 'Tap where to plant the screen.' }),
        })
        list.push({ label: 'Spot up', run: () => issue(id, { kind: 'idle' }) })
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
        ? 'Your ball. Drag a player onto a spot or teammate, then pick an action. Tap to inspect.'
        : 'Defense. Drag onto an opponent to guard/double/steal, or onto a spot to help.'

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
          <div className={`cc__shotclock ${state.shotClock <= 3 ? 'cc__shotclock--warn' : ''}`}>:{String(state.shotClock).padStart(2, '0')}</div>
          <div className="cc__to">first to {WIN_TARGET}</div>
        </div>
        <div className={`cc__score ${!onOffense ? 'cc__score--live' : ''}`}>
          <span className="cc__score-label">CPU</span>
          <span className="cc__score-num">{state.score.ai}</span>
        </div>
      </div>

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
        <button
          type="button"
          className="cc-btn cc-btn--primary cc__run"
          onClick={game.runBeat}
          disabled={animating || state.phase !== 'play'}
        >
          Run Beat ▶
        </button>
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
