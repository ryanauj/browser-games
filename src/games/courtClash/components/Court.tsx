import { useRef, useState } from 'react'
import { BASKET, COURT_H, COURT_W, RIM_RADIUS, SCREEN_RADIUS, THREE_PT_RADIUS, type Risk } from '../constants'
import { GASSED_THRESHOLD } from '../constants'
import { signatureAttr } from '../attributes'
import { dist, reachOf, stepToward } from '../geometry'
import type { Player, Side, Vec } from '../types'

/** One choice in the post-drag radial menu. The first item is the primary. */
export interface RadialItem {
  label: string
  icon: string
  run: () => void
}

export interface CourtProps {
  players: Player[]
  ballHandlerId: string | null
  yourSide: Side
  selectedId: string | null
  /** Player ids currently valid as a tap target (pass/guard/etc. targeting). */
  targetable: Set<string>
  /** Per-target risk color (e.g. pass safety) while in targeting mode. */
  targetRisk: Record<string, Risk>
  /** Risk ring on your ball handler (shot quality), when on offense. */
  shooterRisk: Risk | null
  /** True when a beat is animating (drives the glide timing class). */
  animating: boolean
  /** Current beat duration (ms) — sets the sprite glide duration to match speed. */
  beatMs: number
  flash: { text: string; tone: Risk | 'neutral' } | null
  /** Open radial menu (drop point + contextual actions), if any. */
  radial: { at: Vec; items: RadialItem[] } | null
  onPlayerTap: (id: string) => void
  onCourtTap: (pt: Vec) => void
  /** A drag finished on `at`; `targetId` is the player dropped onto, if any. */
  onDragRelease: (id: string, at: Vec, targetId: string | null) => void
  onRadialCancel: () => void
}

const DRAG_THRESHOLD = 3 // logic units
const DROP_HIT = 7 // logic-unit radius for "dropped onto this player"
/** Release within this radius of the rim = a shot (drag-to-hoop). Shared with
 *  the radial logic in index.tsx so the ghost line and the menu agree. */
export const HOOP_HIT = 10

export function Court(props: CourtProps) {
  const {
    players,
    ballHandlerId,
    yourSide,
    selectedId,
    targetable,
    targetRisk,
    shooterRisk,
    animating,
    beatMs,
    flash,
    radial,
    onPlayerTap,
    onCourtTap,
    onDragRelease,
    onRadialCancel,
  } = props
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; from: Vec; to: Vec; moved: boolean } | null>(null)
  const pendingCourtTap = useRef<Vec | null>(null)

  const toLogic = (e: React.PointerEvent): Vec => {
    const rect = ref.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(COURT_W, ((e.clientX - rect.left) / rect.width) * COURT_W)),
      y: Math.max(0, Math.min(COURT_H, ((e.clientY - rect.top) / rect.height) * COURT_H)),
    }
  }

  const startDrag = (e: React.PointerEvent, p: Player) => {
    e.stopPropagation()
    if (p.side !== yourSide) {
      onPlayerTap(p.id) // tapping an opponent = a target tap
      return
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({ id: p.id, from: { ...p.pos }, to: { ...p.pos }, moved: false })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const to = toLogic(e)
    const moved = Math.hypot(to.x - drag.from.x, to.y - drag.from.y) > DRAG_THRESHOLD
    setDrag({ ...drag, to, moved: drag.moved || moved })
  }

  // True when your side has the ball — only then are burst orders (drive/cut)
  // available, so the outer reach ring is meaningful.
  const onOffense = players.find((p) => p.id === ballHandlerId)?.side === yourSide

  // The ball handler is being dragged onto the rim — arm the hoop and draw the
  // drag as a shot line rather than a clamped move.
  const aimingHoop =
    !!drag && drag.moved && onOffense && drag.id === ballHandlerId && dist(drag.to, BASKET) <= HOOP_HIT

  // Clamp a drag target to one beat's reach for the dragged player. On offense
  // the ghost can stretch to the burst (outer) ring; on defense, the jog ring.
  const clampDrag = (id: string, to: Vec): Vec => {
    const p = players.find((pl) => pl.id === id)
    return p ? stepToward(p.pos, to, reachOf(p, onOffense)) : to
  }

  // Nearest player (any side) under the drop point, if the drag ended on one.
  const dropTarget = (draggedId: string, at: Vec): string | null => {
    let best: { id: string; d: number } | null = null
    for (const p of players) {
      if (p.id === draggedId) continue
      const d = Math.hypot(p.pos.x - at.x, p.pos.y - at.y)
      if (d <= DROP_HIT && (!best || d < best.d)) best = { id: p.id, d }
    }
    return best?.id ?? null
  }

  const onUp = (e: React.PointerEvent) => {
    if (drag) {
      if (drag.moved) {
        const at = toLogic(e)
        onDragRelease(drag.id, at, dropTarget(drag.id, at))
      } else onPlayerTap(drag.id)
      setDrag(null)
      return
    }
    if (pendingCourtTap.current) {
      onCourtTap(toLogic(e))
      pendingCourtTap.current = null
    }
  }

  const onSurfaceDown = (e: React.PointerEvent) => {
    pendingCourtTap.current = toLogic(e)
  }

  const pct = (v: number, span: number) => `${(v / span) * 100}%`

  // Position the radial at the drop point but nudge it inward so every button
  // stays on-court (the menu fans upward, so it needs more room above).
  const radialAnchor = (at: Vec): React.CSSProperties => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { left: pct(at.x, COURT_W), top: pct(at.y, COURT_H) }
    const SIDE = 90 // half the fan's width
    const TOP = 94 // fan reaches up by ~58 + button radius
    const BOTTOM = 38
    const cx = Math.max(SIDE, Math.min(rect.width - SIDE, (at.x / COURT_W) * rect.width))
    const cy = Math.max(TOP, Math.min(rect.height - BOTTOM, (at.y / COURT_H) * rect.height))
    return { left: `${cx}px`, top: `${cy}px` }
  }

  // Standing-order route lines for your players.
  const routes = players
    .filter((p) => p.side === yourSide)
    .map((p) => {
      const o = p.order
      let to: Vec | null = null
      if (o.kind === 'move' || o.kind === 'cut' || o.kind === 'drive' || o.kind === 'help') to = o.to
      else if (o.kind === 'screen') to = (o.markId ? players.find((t) => t.id === o.markId)?.pos : null) ?? o.to
      else if (o.kind === 'pass') to = o.lead ?? players.find((t) => t.id === o.toId)?.pos ?? null
      else if (o.kind === 'guard' || o.kind === 'steal' || o.kind === 'double') {
        const mk = o.kind === 'double' ? ballHandlerId : (o as { markId: string }).markId
        to = players.find((t) => t.id === mk)?.pos ?? null
      }
      if (!to) return null
      const dashed = o.kind === 'pass' || o.kind === 'guard' || o.kind === 'double' || o.kind === 'steal'
      return { id: p.id, from: p.pos, to, kind: o.kind, dashed }
    })
    .filter(Boolean) as { id: string; from: Vec; to: Vec; kind: string; dashed: boolean }[]

  return (
    <div
      className={`cc-court ${animating ? 'cc-court--anim' : ''}`}
      ref={ref}
      style={{ ['--cc-beat' as string]: `${beatMs}ms` }}
      onPointerDown={onSurfaceDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {/* Court markings */}
      <svg className="cc-court__lines" viewBox={`0 0 ${COURT_W} ${COURT_H}`} preserveAspectRatio="none">
        <rect x="0.5" y="0.5" width={COURT_W - 1} height={COURT_H - 1} className="cc-line-stroke" fill="none" />
        {/* paint */}
        <rect x={BASKET.x - 12} y="0" width="24" height="34" className="cc-paint" />
        {/* free-throw circle */}
        <circle cx={BASKET.x} cy="34" r="9" className="cc-line-stroke" fill="none" />
        {/* three-point arc */}
        <path
          d={`M ${BASKET.x - THREE_PT_RADIUS} 0 A ${THREE_PT_RADIUS} ${THREE_PT_RADIUS} 0 0 0 ${
            BASKET.x + THREE_PT_RADIUS
          } 0`}
          className="cc-line-stroke"
          fill="none"
        />
        {/* layup range */}
        <circle cx={BASKET.x} cy={BASKET.y} r={RIM_RADIUS} className="cc-rim-range" fill="none" />
        {/* hoop: backboard + rim + net — the scoring target, lit up while aiming */}
        <g className={`cc-hoop${aimingHoop ? ' cc-hoop--armed' : ''}`}>
          <circle cx={BASKET.x} cy={BASKET.y} r="5.2" className="cc-hoop__glow" />
          <rect x={BASKET.x - 7} y="5.4" width="14" height="1.4" rx="0.5" className="cc-hoop__board" />
          <path
            d={`M ${BASKET.x - 3.2} ${BASKET.y} L ${BASKET.x - 1.9} ${BASKET.y + 4.6} L ${BASKET.x + 1.9} ${
              BASKET.y + 4.6
            } L ${BASKET.x + 3.2} ${BASKET.y} M ${BASKET.x - 1.1} ${BASKET.y} L ${BASKET.x - 0.7} ${
              BASKET.y + 4.6
            } M ${BASKET.x + 1.1} ${BASKET.y} L ${BASKET.x + 0.7} ${BASKET.y + 4.6} M ${BASKET.x - 2.5} ${
              BASKET.y + 2.3
            } L ${BASKET.x + 2.5} ${BASKET.y + 2.3}`}
            className="cc-hoop__net"
          />
          <circle cx={BASKET.x} cy={BASKET.y} r="3.2" className="cc-hoop__rim" />
        </g>
      </svg>

      {/* Route lines */}
      <svg className="cc-court__routes" viewBox={`0 0 ${COURT_W} ${COURT_H}`} preserveAspectRatio="none">
        {routes.map((r) => (
          <line
            key={r.id}
            x1={r.from.x}
            y1={r.from.y}
            x2={r.to.x}
            y2={r.to.y}
            className={`cc-route cc-route--${r.kind}`}
            strokeDasharray={r.dashed ? '3 3' : undefined}
          />
        ))}
        {drag &&
          drag.moved &&
          (() => {
            // Aiming at the rim draws a shot line all the way to the hoop;
            // otherwise the ghost clamps to one beat's reach (a move/drive).
            if (aimingHoop) {
              return (
                <line x1={drag.from.x} y1={drag.from.y} x2={BASKET.x} y2={BASKET.y} className="cc-route cc-route--shot" />
              )
            }
            const c = clampDrag(drag.id, drag.to)
            return <line x1={drag.from.x} y1={drag.from.y} x2={c.x} y2={c.y} className="cc-route cc-route--ghost" />
          })()}
        {(() => {
          // Reach rings on the dragged player (else the selected one): solid inner
          // = jog (move), dashed outer = burst (cut/drive, offense only).
          const rp =
            (drag && players.find((p) => p.id === drag.id)) ||
            players.find((p) => p.id === selectedId && p.side === yourSide)
          if (!rp) return null
          return (
            <>
              {onOffense && (
                <circle cx={rp.pos.x} cy={rp.pos.y} r={reachOf(rp, true)} className="cc-reach cc-reach--burst" />
              )}
              <circle cx={rp.pos.x} cy={rp.pos.y} r={reachOf(rp)} className="cc-reach" />
            </>
          )
        })()}
      </svg>

      {/* Players */}
      {players.map((p) => {
        const isYours = p.side === yourSide
        const hasBall = p.id === ballHandlerId
        const isSel = p.id === selectedId
        const isTarget = targetable.has(p.id)
        const gassed = p.stamina < GASSED_THRESHOLD
        const ring = hasBall && isYours && shooterRisk ? ` cc-player--risk-${shooterRisk}` : ''
        const tRisk = targetRisk[p.id]
        const targetCls = isTarget ? ` cc-player--target${tRisk ? ` cc-player--risk-${tRisk}` : ''}` : ''
        // Screen feedback: a screener shows a pick badge, and goes "planted" once
        // it reaches the man/spot it's screening.
        const screenOrder = p.order.kind === 'screen' ? p.order : null
        const screenTarget = screenOrder
          ? ((screenOrder.markId ? players.find((t) => t.id === screenOrder.markId)?.pos : null) ?? screenOrder.to)
          : null
        const planted = !!screenTarget && dist(p.pos, screenTarget) <= SCREEN_RADIUS
        const screenCls = screenOrder ? ` cc-player--screening${planted ? ' cc-player--planted' : ''}` : ''
        const sig = signatureAttr(p.attr)
        return (
          <button
            type="button"
            key={p.id}
            className={`cc-player cc-player--${p.side}${isSel ? ' cc-player--sel' : ''}${
              hasBall ? ' cc-player--ball' : ''
            }${gassed ? ' cc-player--gassed' : ''}${p.stuck > 0 ? ' cc-player--stuck' : ''}${screenCls}${ring}${targetCls}`}
            style={{ left: pct(p.pos.x, COURT_W), top: pct(p.pos.y, COURT_H) }}
            onPointerDown={(e) => startDrag(e, p)}
          >
            <span className="cc-player__num">{p.number}</span>
            <span className="cc-player__badge" title={sig.label} aria-hidden>
              {sig.icon}
            </span>
            <span className="cc-player__sta" aria-hidden>
              <span
                className={`cc-player__sta-fill cc-player__sta-fill--${
                  p.stamina >= 55 ? 'hi' : p.stamina >= 28 ? 'mid' : 'lo'
                }`}
                style={{ width: `${p.stamina}%` }}
              />
            </span>
            {hasBall && <span className="cc-player__dot" aria-hidden />}
            {screenOrder && (
              <span className="cc-player__screen" title={planted ? 'Screen set' : 'Setting screen'} aria-hidden>
                🧱
              </span>
            )}
            {p.stuck > 0 && (
              <span className="cc-player__stuck" title="Stuck on a screen" aria-hidden>
                💥
              </span>
            )}
          </button>
        )
      })}

      {flash && <div className={`cc-flash cc-flash--${flash.tone}`}>{flash.text}</div>}

      {radial && (
        <div className="cc-radial-backdrop" onPointerDown={() => onRadialCancel()}>
          <div className="cc-radial" style={radialAnchor(radial.at)}>
            {radial.items.map((it, i) => {
              // Item 0 sits at the drop point; the rest fan out in an upward arc.
              const sec = radial.items.length - 1
              const j = i - 1
              const deg = -90 + (j - (sec - 1) / 2) * 48
              const r = i === 0 ? 0 : 58
              const dx = i === 0 ? 0 : Math.cos(deg * (Math.PI / 180)) * r
              const dy = i === 0 ? 0 : Math.sin(deg * (Math.PI / 180)) * r
              return (
                <button
                  type="button"
                  key={it.label}
                  className={`cc-radial__btn ${i === 0 ? 'cc-radial__btn--primary' : ''}`}
                  style={{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    it.run()
                  }}
                >
                  <span className="cc-radial__icon" aria-hidden>
                    {it.icon}
                  </span>
                  <span className="cc-radial__label">{it.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
