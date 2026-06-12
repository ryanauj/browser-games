import { FIT_BONUS, MISMATCH_PENALTY, POSITION_LABELS } from '../constants'
import type { BoardAthlete, Position, Side } from '../types'

interface Props {
  position: Position
  athlete: BoardAthlete | null
  /** Effective stats with fit/ability/buff modifiers baked in. */
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

/** One lineup slot for one side, showing the deployed athlete or an empty bay. */
export function PositionSlot({ position, athlete, eff, side, targetable, onClick }: Props) {
  const classes = ['cc-slot', `cc-slot--${side}`]
  if (targetable) classes.push('cc-slot--targetable')
  if (!athlete) classes.push('cc-slot--empty')

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
            <span className="cc-stat" title="Stamina">
              ❤{athlete.sta}/{athlete.card.sta}
            </span>
          </span>
          <span className={`cc-fit ${fitClass}`}>
            {onPosition
              ? `FIT +${FIT_BONUS}/+${FIT_BONUS}`
              : `OFF-POS −${MISMATCH_PENALTY}/−${MISMATCH_PENALTY}`}
          </span>
        </span>
      ) : (
        <span className="cc-slot__placeholder">{targetable ? 'Place here' : 'Empty'}</span>
      )}
    </button>
  )
}
