import type { PlayCard } from '../types'

interface Props {
  card: PlayCard
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
}

/** A play card as it appears in the coach's hand. */
export function CardView({ card, onClick, selected, disabled }: Props) {
  const classes = ['cc-card', 'cc-card--play']
  if (selected) classes.push('cc-card--selected')
  if (disabled) classes.push('cc-card--disabled')

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className="cc-card__cost">{card.cost}</span>
      <span className="cc-card__name">{card.name}</span>
      <span className="cc-card__text">{card.text}</span>
    </button>
  )
}
