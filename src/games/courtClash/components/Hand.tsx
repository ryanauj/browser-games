import type { Card } from '../types'
import { CardView } from './CardView'

interface Props {
  cards: Card[]
  energy: number
  selectedId: string | null
  onSelect: (cardId: string) => void
}

/** The player's hand. Unaffordable cards are dimmed and unselectable. */
export function Hand({ cards, energy, selectedId, onSelect }: Props) {
  if (cards.length === 0) {
    return <div className="cc-hand cc-hand--empty">No cards in hand.</div>
  }
  return (
    <div className="cc-hand">
      {cards.map((card) => (
        <CardView
          key={card.id}
          card={card}
          selected={card.id === selectedId}
          disabled={card.cost > energy}
          onClick={() => onSelect(card.id)}
        />
      ))}
    </div>
  )
}
