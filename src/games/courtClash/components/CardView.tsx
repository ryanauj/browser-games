import type { Card } from '../types'

interface Props {
  card: Card
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
}

/** A card as it appears in hand: athlete ratings or power-up text. */
export function CardView({ card, onClick, selected, disabled }: Props) {
  const classes = ['cc-card', `cc-card--${card.kind}`]
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
      {card.kind === 'athlete' ? (
        <>
          <span className="cc-card__pos">{card.position}</span>
          <span className="cc-card__stats">
            <span title="Offense">⚡{card.off}</span>
            <span title="Defense">🛡{card.def}</span>
            <span title="Stamina">❤{card.sta}</span>
          </span>
          {card.abilityText && <span className="cc-card__ability">{card.abilityText}</span>}
        </>
      ) : (
        <span className="cc-card__text">{card.text}</span>
      )}
    </button>
  )
}
