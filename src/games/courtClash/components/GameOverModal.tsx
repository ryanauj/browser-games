import type { Side } from '../types'

interface Props {
  winner: Side | 'tie'
  playerScore: number
  aiScore: number
  onNewGame: () => void
}

/** End-of-match overlay with the final score and a rematch button. */
export function GameOverModal({ winner, playerScore, aiScore, onNewGame }: Props) {
  const youWon = winner === 'player'
  const headline = winner === 'tie' ? 'Final Buzzer' : youWon ? 'You Win! 🏆' : 'CPU Wins'

  return (
    <div className="cc-modal">
      <div className="cc-modal__card">
        <h2 className={`cc-modal__title ${youWon ? 'cc-modal__title--win' : ''}`}>{headline}</h2>
        <p className="cc-modal__score">
          YOU {playerScore} — {aiScore} CPU
        </p>
        <button type="button" className="cc-btn cc-btn--primary" onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
  )
}
