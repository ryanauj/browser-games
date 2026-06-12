import { FIT_BONUS, FOUL_LIMIT, MISMATCH_PENALTY, POSITION_LABELS } from '../constants'
import { isGassed } from '../engine'
import type { Position, RosterAthlete, Side } from '../types'

interface Props {
  position: Position
  athlete: RosterAthlete | null
  /** Effective stats with fit/ability/buff/fatigue modifiers baked in. */
  eff?: { off: number; def: number }
  side: Side
  targetable?: boolean
  onClick?: () => void
}

/** A stat with green/red styling when modifiers move it off the base value. */
function Stat({ icon, label, value, base }: { icon: string; label: string; value: number; base: number }) {
  const mod = value > base ? 'cc-stat--up' : value < base ? 'cc-stat--down' : ''
  return (
    <span className={`cc-stat ${mod}`} title={`${label}: ${value} (base ${base})`}>
      {icon}
      {value}
    </span>
  )
}

function FoulDots({ fouls }: { fouls: number }) {
  return (
    <span className="cc-fouls" title={`${fouls}/${FOUL_LIMIT} fouls`}>
      {Array.from({ length: FOUL_LIMIT }, (_, i) => (
        <span key={i} className={i < fouls ? 'cc-fouls__dot cc-fouls__dot--on' : 'cc-fouls__dot'} />
      ))}
    </span>
  )
}

/** One lineup slot for one side: the athlete on court, or a hole after a foul-out. */
export function PositionSlot({ position, athlete, eff, side, targetable, onClick }: Props) {
  const classes = ['cc-slot', `cc-slot--${side}`]
  if (targetable) classes.push('cc-slot--targetable')
  if (!athlete) classes.push('cc-slot--empty')
  if (athlete && isGassed(athlete)) classes.push('cc-slot--gassed')

  const onPosition = athlete ? athlete.card.position === position : false
  const fitClass = athlete ? (onPosition ? 'cc-fit--good' : 'cc-fit--bad') : ''

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={!targetable}
      title={POSITION_LABELS[position]}
    >
      <span className="cc-slot__pos">{position}</span>
      {athlete ? (
        <span className="cc-slot__body">
          <span className="cc-slot__name">{athlete.card.name}</span>
          <span className="cc-slot__stats">
            <Stat icon="⚡" label="Offense" value={eff?.off ?? athlete.card.off} base={athlete.card.off} />
            <Stat icon="🛡" label="Defense" value={eff?.def ?? athlete.card.def} base={athlete.card.def} />
            <span
              className={`cc-stat ${athlete.sta <= 2 ? 'cc-stat--down' : ''}`}
              title={`Stamina ${athlete.sta}/${athlete.card.sta}`}
            >
              ❤{athlete.sta}
            </span>
          </span>
          <span className="cc-slot__meta">
            <FoulDots fouls={athlete.fouls} />
            {isGassed(athlete) ? (
              <span className="cc-slot__gassed">GASSED</span>
            ) : (
              <span className={`cc-fit ${fitClass}`}>
                {onPosition ? `FIT +${FIT_BONUS}` : `OFF-POS −${MISMATCH_PENALTY}`}
              </span>
            )}
          </span>
        </span>
      ) : (
        <span className="cc-slot__placeholder">{targetable ? 'Sub here' : 'Open spot'}</span>
      )}
    </button>
  )
}
