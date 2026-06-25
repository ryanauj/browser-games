import { useEffect, useRef, useState } from 'react'
import { BASKET, COURT_H, COURT_W, LEAD_CATCH_RADIUS, RIM_RADIUS, SCREEN_RADIUS, THREE_PT_RADIUS, type Risk } from '../constants'
import { GASSED_THRESHOLD } from '../constants'
import { signatureAttr } from '../attributes'
import { contestedStep, dist, leadCatch, reachOf, sprintTopOf, stepToward } from '../geometry'
import type { Ball, MoveMode, Order, Player, ShotGather, Side, Vec } from '../types'

/** One choice in the post-drag radial menu. The first item is the primary. */
export interface RadialItem {
  label: string
  icon: string
  run: () => void
}

/** One leg of the ball's travel this beat: a straight hop with an optional lob
 *  arc (peak height in floor units; 0 = a flat line). */
export interface BallSeg {
  from: Vec
  to: Vec
  arc: number
}

/** The ball's animated travel for the beat just resolved. `lane` draws the throw
 *  lane for legibility; `contestId` flags the defender nearest it (the man who
 *  could pick it). `key` remounts the animation each beat so it replays. */
export interface BallFlight {
  key: string
  tone: 'pass' | 'make' | 'miss' | 'steal' | 'turnover' | 'block'
  segments: BallSeg[]
  lane?: { from: Vec; to: Vec }
  contestId?: string
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
  /** True when a step is animating (drives the glide timing class). */
  animating: boolean
  /** Current step duration (ms) — sets the sprite glide duration to match speed. */
  beatMs: number
  flash: { text: string; tone: Risk | 'neutral' } | null
  /** Ball travel to animate for the resolution step just resolved (catch/shot/
   *  steal). Only non-null while a step is gliding. */
  ballFlight: BallFlight | null
  /** A ball traveling on its own RIGHT NOW (Q18/Q31) — a pass mid-flight. Drawn as
   *  a live token at its current spot with a faint from→to lane, gliding to the
   *  next spot each step. While set, `ballHandlerId` is null (a valid in-air
   *  state). null = the ball is held / not in flight. */
  ball: Ball | null
  /** A shot in its windup (Q17/Q33) — the shooter is rooted and gathering while
   *  the defense can still close. null = no shot gathering. */
  gather: ShotGather | null
  /** Open radial menu (drop point + contextual actions), if any. `note` is an
   *  optional one-line caption explaining the offered actions (e.g. lead pass). */
  radial: { at: Vec; items: RadialItem[]; note?: string } | null
  /** Pulse YOUR ball handler to answer "who has the ball" during onboarding. */
  handlerCue?: boolean
  /** The plan being AUTHORED right now (Q46), if any — its `legs` are drawn as a
   *  live chain from the player's current spot so you can see the path as you lay
   *  it. OWN player only (the UI only ever opens a draft for your side). */
  draft: { playerId: string; legs: Order[]; mode: MoveMode } | null
  /** On-court floating quick-controls for the active plan (Q48/Q3 of the P3
   *  follow-up): speed toggle, screen tool, undo, (shoot), commit, cancel — anchored
   *  near the player so the thumb stays on the floor. null when not planning. */
  planUI: {
    pos: Vec
    mode: MoveMode
    count: number
    screenArmed: boolean
    isHandler: boolean
    onMode: (m: MoveMode) => void
    onScreen: () => void
    onUndo: () => void
    onShoot: () => void
    onCommit: () => void
    onCancel: () => void
  } | null
  onPlayerTap: (id: string) => void
  onCourtTap: (pt: Vec) => void
  /** A drag finished on `at`; `targetId` is the player dropped onto, if any. */
  onDragRelease: (id: string, at: Vec, targetId: string | null) => void
  onRadialCancel: () => void
  /** Grabbing one of your players to edit pauses an in-progress auto-run (Q48). */
  onInterrupt?: () => void
}

const DRAG_THRESHOLD = 5 // logic units — high enough that a jostle on a moving train doesn't open a stray radial
const DROP_HIT = 7 // logic-unit radius for "dropped onto this player"
/** Release within this radius of the rim = a shot (drag-to-hoop). Shared with
 *  the radial logic in index.tsx so the ghost line and the menu agree. */
export const HOOP_HIT = 10

/** The floor point an order RELOCATES the player to, or null for an order that
 *  holds position (pass / idle / reactive). Mirrors the single-order route logic so
 *  a queue chain and its head route agree. */
function movePoint(o: Order, players: Player[]): Vec | null {
  if (o.kind === 'move' || o.kind === 'cut' || o.kind === 'drive' || o.kind === 'help') return o.to
  if (o.kind === 'screen') return (o.markId ? players.find((t) => t.id === o.markId)?.pos : null) ?? o.to
  return null
}

/** A non-move order's marker glyph along the chain (null = a plain movement
 *  waypoint, drawn as a numbered node only). */
function linkGlyph(o: Order): string | null {
  if (o.kind === 'screen') return '🧱'
  if (o.kind === 'pass') return '🤝'
  if (o.kind === 'idle') return '⏸'
  return null
}

/** A segment's visual class — jog (thin), sprint (thick/animated) or a screen
 *  approach — so the path reads its own intent at a glance (not all teal dots). */
type SegCls = 'jog' | 'sprint' | 'screen'
function segClsOf(o: Order): SegCls {
  if (o.kind === 'screen') return 'screen'
  if (o.kind === 'move') return o.mode === 'sprint' ? 'sprint' : 'jog'
  if (o.kind === 'cut' || o.kind === 'drive') return 'sprint'
  if (o.kind === 'help') return o.mode === 'sprint' ? 'sprint' : 'jog'
  return 'jog'
}

interface ChainLink {
  pt: Vec
  order: Order
  seq: number
}
interface PlanChain {
  id: string
  segs: { from: Vec; to: Vec; cls: SegCls }[]
  links: ChainLink[]
}

/** Walk an order list from `start`, emitting a segment + node for each relocating
 *  order and an in-place marker for each hold/pass — the planned path + action
 *  points that the queue viz (Q15) and the live draft (Q46) both render. */
function buildChain(id: string, start: Vec, orders: Order[], players: Player[]): PlanChain {
  let cursor = start
  const segs: { from: Vec; to: Vec; cls: SegCls }[] = []
  const links: ChainLink[] = []
  orders.forEach((o, i) => {
    const mp = movePoint(o, players)
    if (mp) {
      segs.push({ from: cursor, to: mp, cls: segClsOf(o) })
      links.push({ pt: { ...mp }, order: o, seq: i + 1 })
      cursor = mp
    } else {
      links.push({ pt: { ...cursor }, order: o, seq: i + 1 })
    }
  })
  return { id, segs, links }
}

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
    ballFlight,
    ball,
    gather,
    radial,
    handlerCue,
    draft,
    planUI,
    onPlayerTap,
    onCourtTap,
    onDragRelease,
    onRadialCancel,
    onInterrupt,
  } = props
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; from: Vec; to: Vec; moved: boolean } | null>(null)
  const pendingCourtTap = useRef<Vec | null>(null)

  // Manual offset (logic units) for the floating plan menu — the user can drag it
  // off the action by its grip. Reset whenever a plan closes so the next one opens
  // anchored to its player again.
  const [menuOffset, setMenuOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const menuDrag = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null)
  useEffect(() => {
    if (!planUI) setMenuOffset({ dx: 0, dy: 0 })
  }, [!!planUI])

  const startMenuDrag = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    menuDrag.current = { startX: e.clientX, startY: e.clientY, baseDx: menuOffset.dx, baseDy: menuOffset.dy }
  }
  const moveMenuDrag = (e: React.PointerEvent) => {
    if (!menuDrag.current || !ref.current) return
    e.stopPropagation()
    const rect = ref.current.getBoundingClientRect()
    setMenuOffset({
      dx: menuDrag.current.baseDx + ((e.clientX - menuDrag.current.startX) / rect.width) * COURT_W,
      dy: menuDrag.current.baseDy + ((e.clientY - menuDrag.current.startY) / rect.height) * COURT_H,
    })
  }
  const endMenuDrag = (e: React.PointerEvent) => {
    if (!menuDrag.current) return
    e.stopPropagation()
    menuDrag.current = null
  }

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
    onInterrupt?.() // hands on the wheel — pause any running auto-advance (Q48)
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

  // Clamp a drag target to one beat's reach for the dragged player, then bleed
  // off any ground the defense would take away — so the ghost line ends where the
  // sim will actually stop you (a drive into traffic comes up short here too, not
  // just at resolution). On offense the ghost can stretch to the burst (outer)
  // ring; on defense, the jog ring.
  const clampDrag = (id: string, to: Vec): Vec => {
    const p = players.find((pl) => pl.id === id)
    if (!p) return to
    const reached = stepToward(p.pos, to, reachOf(p, onOffense))
    // Only the attacking side loses ground to bodies (matches the engine: the
    // defense isn't slowed by the man it's guarding). Off defense, ghost = reach.
    if (!onOffense) return reached
    const bodies = players.filter((o) => o.side !== p.side && o.id !== p.id && o.order.kind !== 'screen')
    return contestedStep(p.pos, reached, bodies, p.attr.strength)
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

  // Radial fan geometry. The menu fans away from the drop point; near the court's
  // top edge it would clip, so it flips to fan DOWNWARD instead (bottom-fan
  // fallback). Radius is wide enough that the buttons don't stack/overlap.
  const RADIAL_R = 66 // fan radius (widened so 52px buttons don't clip on narrow screens)
  const RADIAL_SPREAD = 46 // degrees between buttons
  const radialFanDown = (at: Vec): boolean => at.y < COURT_H * 0.34

  // Position the drop point but nudge it inward so every button stays on-court;
  // reserve the bigger margin on the side the fan opens toward.
  const radialAnchor = (at: Vec, fanDown: boolean): React.CSSProperties => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { left: pct(at.x, COURT_W), top: pct(at.y, COURT_H) }
    const SIDE = 96 // half the fan's width (RADIAL_R + button radius)
    const REACH = 104 // room the fan needs on the side it opens toward
    const NEAR = 40 // small margin on the opposite (anchor) side
    const top = fanDown ? NEAR : REACH
    const bottom = fanDown ? REACH : NEAR
    const cx = Math.max(SIDE, Math.min(rect.width - SIDE, (at.x / COURT_W) * rect.width))
    const cy = Math.max(top, Math.min(rect.height - bottom, (at.y / COURT_H) * rect.height))
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

  // OWN-SIDE QUEUE VIZ (Q15). Render the human's committed CHAIN — the active
  // order already draws its head route (p.pos → order.to); this continues it through
  // the pending `queue`, front-to-back, with a numbered node per waypoint and a glyph
  // at each non-move action point. OWN players only — the opponent's queue is never
  // shown (you infer it from motion). The chain starts where the active order leaves
  // the player (its endpoint), so the head route and the chain meet seamlessly.
  const planChains = players
    .filter((p) => p.side === yourSide && p.queue.length > 0)
    .map((p) => buildChain(p.id, movePoint(p.order, players) ?? p.pos, p.queue, players))

  // The live AUTHORING draft (Q46) — drawn from the player's CURRENT spot through
  // every laid leg (nothing committed yet), in a brighter "drafting" style.
  const draftPlayer = draft ? players.find((p) => p.id === draft.playerId) : null
  const draftChain = draft && draftPlayer ? buildChain(draftPlayer.id, draftPlayer.pos, draft.legs, players) : null

  // MOTION TELEGRAPH (Q15). The ONLY committed-intent cue shown for BOTH sides:
  // a player's tracked sprint speed/heading (`sprintSpeed`/`sprintDir`). You read
  // the opponent purely from this observable motion — no opponent order lines.
  // A streak trails each sprinter back along its heading; faster = longer/heavier
  // (a fast committed drive bleeds the most ⇒ the highest bail cost ⇒ the most
  // committed). A jog (no sprintSpeed) leaves no streak — that absence IS the
  // jog-vs-sprint read.
  const trails = players
    .map((p) => {
      const sp = p.sprintSpeed
      const dir = p.sprintDir
      if (!dir || sp < 1) return null
      const frac = Math.min(1, sp / sprintTopOf(p))
      // The streak spans the ground covered last step, drawn behind the player.
      const tail = { x: p.pos.x - dir.x * sp, y: p.pos.y - dir.y * sp }
      return { id: p.id, side: p.side, from: tail, to: p.pos, frac }
    })
    .filter(Boolean) as { id: string; side: Side; from: Vec; to: Vec; frac: number }[]

  // A shot in its windup — telegraph an expanding "release" ring on the shooter so
  // either side can read it (close it out on defense, hold steady on offense).
  const gatherShooter = gather ? players.find((p) => p.id === gather.shooterId) : null

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
        {/* Motion trails (Q15) — drawn first so they sit beneath the order lines.
            Width + opacity scale with sprint speed; color reads team. */}
        {trails.map((t) => (
          <line
            key={`tr-${t.id}`}
            x1={t.from.x}
            y1={t.from.y}
            x2={t.to.x}
            y2={t.to.y}
            className={`cc-trail cc-trail--${t.side}${t.frac > 0.6 ? ' cc-trail--fast' : ''}`}
            style={{ strokeWidth: 1.4 + t.frac * 3, opacity: 0.22 + t.frac * 0.5 }}
          />
        ))}
        {/* Gather windup ring (Q17) — an expanding telegraph on the rooted shooter. */}
        {gatherShooter && (
          <circle
            cx={gatherShooter.pos.x}
            cy={gatherShooter.pos.y}
            r={7}
            className="cc-gather-ring"
          />
        )}
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
        {/* Committed queue chains (Q15, OWN only) + the live draft (Q46). Lines +
            nodes here; the numbered/glyph badges are HTML below (emoji legibility). */}
        {planChains.map((c) => (
          <g key={`plan-${c.id}`}>
            {c.segs.map((s, i) => (
              <line key={i} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} className={`cc-plan-seg cc-plan-seg--${s.cls}`} />
            ))}
            {c.links.map((l) => (
              <circle key={l.seq} cx={l.pt.x} cy={l.pt.y} r={1.7} className="cc-plan-node" />
            ))}
          </g>
        ))}
        {draftChain && (
          <g>
            {draftChain.segs.map((s, i) => (
              <line key={i} x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} className={`cc-plan-seg cc-plan-seg--${s.cls} cc-plan-seg--draft`} />
            ))}
            {draftChain.links.map((l) => (
              <circle key={l.seq} cx={l.pt.x} cy={l.pt.y} r={2.1} className="cc-draft-node" />
            ))}
          </g>
        )}
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
        {drag &&
          drag.moved &&
          onOffense &&
          drag.id === ballHandlerId &&
          !aimingHoop &&
          (() => {
            // Lead-pass affordance: highlight each cutter's route as a catch
            // corridor and pip the aim point green (a teammate can gather it
            // there) or red (it would sail past everyone — a turnover). Mirrors
            // bestLeadTarget so what you see matches what fires.
            const movers = players.filter(
              (m) =>
                m.side === yourSide &&
                m.id !== drag.id &&
                (m.order.kind === 'move' || m.order.kind === 'cut' || m.order.kind === 'drive'),
            )
            let best: Player | null = null
            let bestMiss = Infinity
            for (const m of players) {
              if (m.side !== yourSide || m.id === drag.id) continue
              const { miss } = leadCatch(m, drag.to)
              if (miss < bestMiss) {
                bestMiss = miss
                best = m
              }
            }
            const ok = !!best && bestMiss <= LEAD_CATCH_RADIUS
            return (
              <>
                {movers.map((m) => {
                  const o = m.order as { to: Vec }
                  return (
                    <line
                      key={m.id}
                      x1={m.pos.x}
                      y1={m.pos.y}
                      x2={o.to.x}
                      y2={o.to.y}
                      className={`cc-lead-lane${best && m.id === best.id ? ' cc-lead-lane--active' : ''}`}
                    />
                  )
                })}
                <circle cx={drag.to.x} cy={drag.to.y} r={2.8} className={`cc-lead-pip cc-lead-pip--${ok ? 'ok' : 'risk'}`} />
              </>
            )
          })()}
        {ballFlight?.lane && (
          <line
            x1={ballFlight.lane.from.x}
            y1={ballFlight.lane.from.y}
            x2={ballFlight.lane.to.x}
            y2={ballFlight.lane.to.y}
            className={`cc-pass-lane cc-pass-lane--${ballFlight.tone}`}
          />
        )}
      </svg>

      {/* Plan waypoint badges (Q15 committed + Q46 draft) — numbered chips with an
          action glyph, as HTML so emoji render crisply. Own-side only by
          construction (planChains filters to yourSide; a draft is always yours). */}
      {[...planChains.map((c) => ({ c, isDraft: false })), ...(draftChain ? [{ c: draftChain, isDraft: true }] : [])].map(
        ({ c, isDraft }) =>
          c.links.map((l) => {
            const glyph = linkGlyph(l.order)
            return (
              <span
                key={`${isDraft ? 'd' : 'p'}-${c.id}-${l.seq}`}
                className={`cc-plan-mark${isDraft ? ' cc-plan-mark--draft' : ''}`}
                style={{ left: pct(l.pt.x, COURT_W), top: pct(l.pt.y, COURT_H) }}
                aria-hidden
              >
                <span className="cc-plan-mark__n">{l.seq}</span>
                {glyph && <span className="cc-plan-mark__g">{glyph}</span>}
              </span>
            )
          }),
      )}

      {/* The ball in flight — each leg a keyframed hop (arc baked into a midpoint
          stop). Legs run back-to-back across the beat, weighted by distance. */}
      {ballFlight && (
        <div className="cc-ball-layer" key={ballFlight.key} aria-hidden>
          {(() => {
            const lens = ballFlight.segments.map((s) => Math.max(6, dist(s.from, s.to)))
            const total = lens.reduce((a, b) => a + b, 0)
            let acc = 0
            return ballFlight.segments.map((s, i) => {
              const delayMs = beatMs * (acc / total)
              const durMs = beatMs * (lens[i] / total)
              acc += lens[i]
              const mx = (s.from.x + s.to.x) / 2
              const my = Math.max(0, (s.from.y + s.to.y) / 2 - s.arc)
              const style = {
                ['--x0']: pct(s.from.x, COURT_W),
                ['--y0']: pct(s.from.y, COURT_H),
                ['--xm']: pct(mx, COURT_W),
                ['--ym']: pct(my, COURT_H),
                ['--x1']: pct(s.to.x, COURT_W),
                ['--y1']: pct(s.to.y, COURT_H),
                animationDuration: `${durMs}ms`,
                animationDelay: `${delayMs}ms`,
              } as React.CSSProperties
              return <span key={i} className={`cc-ball cc-ball--${ballFlight.tone}`} style={style} />
            })
          })()}
        </div>
      )}

      {/* The ball traveling on its own RIGHT NOW (Q18/Q31). A live token sitting at
          the ball's current spot — it glides to the next spot each step (CSS
          transition, like the sprites) and shows a faint from→to aim lane so the
          throw is readable while it's in the air. Distinct from the resolution
          ballFlight above (which animates a catch/shot/steal within one glide). */}
      {ball && (
        <>
          <svg className="cc-court__routes" viewBox={`0 0 ${COURT_W} ${COURT_H}`} preserveAspectRatio="none">
            <line
              x1={ball.from.x}
              y1={ball.from.y}
              x2={ball.to.x}
              y2={ball.to.y}
              className={`cc-air-lane cc-air-lane--${ball.kind}`}
            />
          </svg>
          <span
            className="cc-liveball"
            style={{ left: pct(ball.pos.x, COURT_W), top: pct(ball.pos.y, COURT_H), ['--cc-beat' as string]: `${beatMs}ms` }}
            aria-hidden
          />
        </>
      )}

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
        // The defender nearest a pass/steal lane in flight — lit up as the man
        // who could (or did) pick it off.
        const contestCls = ballFlight?.contestId === p.id ? ' cc-player--contest' : ''
        // Motion legibility (Q15), shown for BOTH sides from observable speed: a
        // sprinter reads "sprinting", a near-top committed drive reads "driving"
        // (a heavier token). A jogging/idle player gets neither — the absence is
        // the read.
        const sprintFrac = p.sprintSpeed >= 1 ? Math.min(1, p.sprintSpeed / sprintTopOf(p)) : 0
        const motionCls = sprintFrac > 0.6 ? ' cc-player--driving' : sprintFrac > 0 ? ' cc-player--sprinting' : ''
        // Shot windup, loose handle, and a primed finish — readable risk/juice.
        const gatherCls = gather?.shooterId === p.id ? ' cc-player--gather' : ''
        const looseCls = p.bull > 0 ? ' cc-player--loose' : ''
        const primedCls = p.primed > 0 ? ' cc-player--primed' : ''
        const sig = signatureAttr(p.attr)
        return (
          <button
            type="button"
            key={p.id}
            className={`cc-player cc-player--${p.side}${isSel ? ' cc-player--sel' : ''}${
              hasBall ? ' cc-player--ball' : ''
            }${gassed ? ' cc-player--gassed' : ''}${p.stuck > 0 ? ' cc-player--stuck' : ''}${screenCls}${ring}${targetCls}${contestCls}${motionCls}${gatherCls}${looseCls}${primedCls}`}
            style={{ left: pct(p.pos.x, COURT_W), top: pct(p.pos.y, COURT_H) }}
            onPointerDown={(e) => startDrag(e, p)}
          >
            {/* Invisible hit area floored at the 44px touch-target minimum, so a
                near-miss grabs the player instead of firing a stray court tap —
                without enlarging the visual token. */}
            <span className="cc-player__hit" aria-hidden />
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
            {hasBall && !ballFlight && (
          <span
            className={`cc-player__dot${isYours ? ' cc-player__dot--mine' : ''}${
              hasBall && isYours && handlerCue ? ' cc-player__dot--cue' : ''
            }`}
            title="Has the ball"
            aria-hidden
          >
            🏀
          </span>
        )}
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
            {gatherCls && (
              <span className="cc-player__gather" title="Gathering for a shot — close out!" aria-hidden>
                🎯
              </span>
            )}
            {looseCls && !gatherCls && (
              <span className="cc-player__loose" title="Loose handle — strip risk" aria-hidden>
                〽️
              </span>
            )}
          </button>
        )
      })}

      {/* Live closeout cue (Q17) — the shooter's gather is observable motion, so
          surface it as legible UI (not just the aria-hidden 🎯 badge): the defense
          reads "close out!" and the offense "hold steady" during the 2–3 step
          window. Own-orders-only telegraph is preserved — this mirrors the visible
          windup ring, not a hidden order. */}
      {gatherShooter && (
        <div
          className={`cc-closeout cc-closeout--${gatherShooter.side === yourSide ? 'mine' : 'theirs'}`}
          style={{ left: pct(gatherShooter.pos.x, COURT_W), top: pct(gatherShooter.pos.y, COURT_H) }}
          role="status"
        >
          {gatherShooter.side === yourSide ? '🎯 Gathering — hold' : '🎯 Close out!'}
        </div>
      )}

      {/* Floating plan controls (Q46/Q48) — anchored at the player being authored so
          the thumb stays on the floor while laying the path. Speed toggle, screen
          tool, undo, (shoot, handler only), commit, cancel. stopPropagation keeps a
          button tap from also dropping a waypoint on the court surface. */}
      {planUI &&
        (() => {
          // Anchor at the player, plus the user's manual drag offset (clamped so the
          // cluster stays on the clipped court). Bias the X anchor toward the near
          // edge and flip above the token in the bottom third.
          const ax = Math.max(6, Math.min(94, planUI.pos.x + menuOffset.dx))
          const ay = Math.max(4, Math.min(96, planUI.pos.y + menuOffset.dy))
          const moved = menuOffset.dx !== 0 || menuOffset.dy !== 0
          const tx = ax < 24 ? '-12%' : ax > 76 ? '-88%' : '-50%'
          // Once dragged, sit ON the chosen point (no token-relative flip).
          const ty = moved ? '-50%' : planUI.pos.y > 66 ? 'calc(-100% - 26px)' : '26px'
          return (
            <div
              className="cc-planmenu"
              style={{ left: pct(ax, COURT_W), top: pct(ay, COURT_H), transform: `translate(${tx}, ${ty})` }}
              onPointerDown={(e) => e.stopPropagation()}
              role="group"
              aria-label="Plan controls"
            >
          <span
            className="cc-planmenu__grip"
            onPointerDown={startMenuDrag}
            onPointerMove={moveMenuDrag}
            onPointerUp={endMenuDrag}
            onPointerCancel={endMenuDrag}
            title="Drag to move these controls"
            aria-hidden
          >
            ⠿
          </span>
          <div className="cc-planmenu__seg">
            <button type="button" className={`cc-seg${planUI.mode === 'jog' ? ' cc-seg--on' : ''}`} onClick={planUI.onMode.bind(null, 'jog')}>
              👟
            </button>
            <button type="button" className={`cc-seg${planUI.mode === 'sprint' ? ' cc-seg--on' : ''}`} onClick={planUI.onMode.bind(null, 'sprint')}>
              ⚡
            </button>
          </div>
          <button type="button" className={`cc-planmenu__btn${planUI.screenArmed ? ' cc-planmenu__btn--armed' : ''}`} onClick={planUI.onScreen} title="Set a screen at a spot">
            🧱
          </button>
          <button type="button" className="cc-planmenu__btn" onClick={planUI.onUndo} disabled={planUI.count === 0} title="Undo last waypoint">
            ↶
          </button>
          {planUI.isHandler && (
            <button type="button" className="cc-planmenu__btn" onClick={planUI.onShoot} title="Shoot now">
              🏀
            </button>
          )}
          <button type="button" className="cc-planmenu__btn cc-planmenu__btn--ok" onClick={planUI.onCommit} disabled={planUI.count === 0} title="Commit the plan">
            ✓<span className="cc-planmenu__n">{planUI.count}</span>
          </button>
              <button type="button" className="cc-planmenu__btn cc-planmenu__btn--x" onClick={planUI.onCancel} title="Cancel">
                ✕
              </button>
            </div>
          )
        })()}

      {flash && <div className={`cc-flash cc-flash--${flash.tone}`}>{flash.text}</div>}

      {radial && (
        <div className="cc-radial-backdrop" onPointerDown={() => onRadialCancel()}>
          {radial.note && <div className="cc-radial-note">{radial.note}</div>}
          {(() => {
            const fanDown = radialFanDown(radial.at)
            const base = fanDown ? 90 : -90 // fan opens down near the top edge, else up
            return (
              <div className="cc-radial" style={radialAnchor(radial.at, fanDown)}>
                {radial.items.map((it, i) => {
                  // Item 0 sits at the drop point; the rest fan out in an arc.
                  const sec = radial.items.length - 1
                  const j = i - 1
                  const deg = base + (j - (sec - 1) / 2) * RADIAL_SPREAD
                  const r = i === 0 ? 0 : RADIAL_R
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
            )
          })()}
        </div>
      )}
    </div>
  )
}
