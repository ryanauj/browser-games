import { POSITION_LABELS } from '../constants'
import type { BoardAthlete, Position, Side } from '../types'

interface Props {
  position: Position
  athlete: BoardAthlete | null
  side: Side
  targetable?: boolean
  onClick?: () => void
}

/** One lineup slot for one side, showing the deployed athlete or an empty bay. */
export function PositionSlot({ position, athlete, side, targetable, onClick }: Props) {
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
            <span title="Offense">⚡{athlete.card.off}</span>
            <span title="Defense">🛡{athlete.card.def}</span>
            <span title="Stamina">
              ❤{athlete.sta}/{athlete.card.sta}
            </span>
          </span>
          <span className={`cc-fit ${fitClass}`}>{onPosition ? 'IN POSITION' : 'OUT OF POSITION'}</span>
        </span>
      ) : (
        <span className="cc-slot__placeholder">{targetable ? 'Place here' : 'Empty'}</span>
      )}
    </button>
  )
}
