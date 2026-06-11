import { SHOT_CLOCK_SECONDS } from '../constants'

interface Props {
  seconds: number
  paused: boolean
  onTogglePause: () => void
}

/** Real-time shot clock with a pause toggle; turns urgent under 6 seconds. */
export function ShotClock({ seconds, paused, onTogglePause }: Props) {
  const urgent = seconds <= 6 && !paused
  const classes = ['cc-shotclock']
  if (urgent) classes.push('cc-shotclock--urgent')
  if (paused) classes.push('cc-shotclock--paused')

  return (
    <div className={classes.join(' ')}>
      <span className="cc-shotclock__label">SHOT CLOCK</span>
      <span className="cc-shotclock__value">{paused ? '—' : seconds}</span>
      <button type="button" className="cc-shotclock__pause" onClick={onTogglePause}>
        {paused ? 'Resume' : 'Pause'}
      </button>
      <span className="cc-shotclock__max">/ {SHOT_CLOCK_SECONDS}s</span>
    </div>
  )
}
