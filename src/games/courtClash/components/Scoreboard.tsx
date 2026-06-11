import { QUARTERS } from '../constants'

interface Props {
  playerScore: number
  aiScore: number
  quarter: number
  gameClock: number
}

function quarterLabel(quarter: number): string {
  return quarter <= QUARTERS ? `Q${quarter}` : `OT${quarter - QUARTERS}`
}

function clockLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Arena scoreboard: both scores, current quarter and the game clock. */
export function Scoreboard({ playerScore, aiScore, quarter, gameClock }: Props) {
  return (
    <div className="cc-scoreboard">
      <div className="cc-scoreboard__team">
        <span className="cc-scoreboard__name">YOU</span>
        <span className="cc-scoreboard__score">{playerScore}</span>
      </div>
      <div className="cc-scoreboard__center">
        <span className="cc-scoreboard__quarter">{quarterLabel(quarter)}</span>
        <span className="cc-scoreboard__clock">{clockLabel(gameClock)}</span>
      </div>
      <div className="cc-scoreboard__team">
        <span className="cc-scoreboard__name">CPU</span>
        <span className="cc-scoreboard__score">{aiScore}</span>
      </div>
    </div>
  )
}
