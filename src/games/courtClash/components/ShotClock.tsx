import { SHOT_CLOCK_SECONDS } from '../constants'

interface Props {
  seconds: number
  timed: boolean
  onToggleTimed: () => void
}

/**
 * Opt-in real-time shot clock. Off by default so new players can think;
 * when on, it counts down 24s per possession and turns urgent under 6.
 */
export function ShotClock({ seconds, timed, onToggleTimed }: Props) {
  const urgent = timed && seconds <= 6
  const classes = ['cc-shotclock']
  if (urgent) classes.push('cc-shotclock--urgent')
  if (!timed) classes.push('cc-shotclock--off')

  return (
    <div className={classes.join(' ')}>
      <span className="cc-shotclock__label">SHOT CLOCK</span>
      <span className="cc-shotclock__value">{timed ? seconds : '—'}</span>
      <button
        type="button"
        className="cc-shotclock__toggle"
        onClick={onToggleTimed}
        aria-pressed={timed}
        title={timed ? 'Turn off the shot clock' : `Race a real ${SHOT_CLOCK_SECONDS}s clock each possession`}
      >
        {timed ? 'On' : 'Off'}
      </button>
    </div>
  )
}
