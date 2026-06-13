import { useRef, useState } from 'react'
import { BASKET, COURT_H, COURT_W, RIM_RADIUS, THREE_PT_RADIUS, type Risk } from '../constants'
import { GASSED_THRESHOLD } from '../constants'
import { signatureAttr } from '../attributes'
import type { Player, Side, Vec } from '../types'

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
  flash: { text: string; tone: Risk | 'neutral' } | null
  onPlayerTap: (id: string) => void
  onCourtTap: (pt: Vec) => void
  onDragRoute: (id: string, to: Vec) => void
}

const DRAG_THRESHOLD = 3 // logic units

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
    flash,
    onPlayerTap,
    onCourtTap,
    onDragRoute,
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

  const onUp = (e: React.PointerEvent) => {
    if (drag) {
      if (drag.moved) onDragRoute(drag.id, toLogic(e))
      else onPlayerTap(drag.id)
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

  // Standing-order route lines for your players.
  const routes = players
    .filter((p) => p.side === yourSide)
    .map((p) => {
      const o = p.order
      let to: Vec | null = null
      if (o.kind === 'move' || o.kind === 'cut' || o.kind === 'drive' || o.kind === 'help' || o.kind === 'screen')
        to = o.to
      else if (o.kind === 'pass') to = players.find((t) => t.id === o.toId)?.pos ?? null
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
        {/* rim */}
        <circle cx={BASKET.x} cy={BASKET.y} r="2.4" className="cc-rim" />
        <circle cx={BASKET.x} cy={BASKET.y} r={RIM_RADIUS} className="cc-rim-range" fill="none" />
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
        {drag && drag.moved && (
          <line x1={drag.from.x} y1={drag.from.y} x2={drag.to.x} y2={drag.to.y} className="cc-route cc-route--ghost" />
        )}
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
        const sig = signatureAttr(p.attr)
        return (
          <button
            type="button"
            key={p.id}
            className={`cc-player cc-player--${p.side}${isSel ? ' cc-player--sel' : ''}${
              hasBall ? ' cc-player--ball' : ''
            }${gassed ? ' cc-player--gassed' : ''}${p.stuck > 0 ? ' cc-player--stuck' : ''}${ring}${targetCls}`}
            style={{ left: pct(p.pos.x, COURT_W), top: pct(p.pos.y, COURT_H) }}
            onPointerDown={(e) => startDrag(e, p)}
          >
            <span className="cc-player__num">{p.number}</span>
            <span className="cc-player__badge" title={sig.label} aria-hidden>
              {sig.icon}
            </span>
            <span className="cc-player__stamina" style={{ width: `${p.stamina}%` }} />
            {hasBall && <span className="cc-player__dot" aria-hidden />}
            {p.stuck > 0 && <span className="cc-player__stuck" aria-hidden />}
          </button>
        )
      })}

      {flash && <div className={`cc-flash cc-flash--${flash.tone}`}>{flash.text}</div>}
    </div>
  )
}
