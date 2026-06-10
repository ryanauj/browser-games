import { POSITIONS } from '../constants'
import type { Lineup, Position } from '../types'
import { PositionSlot } from './PositionSlot'

interface Props {
  playerLineup: Lineup
  aiLineup: Lineup
  targetablePlayerSlots: Set<Position>
  targetableAiSlots: Set<Position>
  onPlayerSlotClick: (pos: Position) => void
  onAiSlotClick: (pos: Position) => void
}

/** The court: CPU lineup on top, your lineup on the bottom, five columns. */
export function Board({
  playerLineup,
  aiLineup,
  targetablePlayerSlots,
  targetableAiSlots,
  onPlayerSlotClick,
  onAiSlotClick,
}: Props) {
  return (
    <div className="cc-board">
      <div className="cc-board__label cc-board__label--ai">CPU</div>
      <div className="cc-board__row">
        {POSITIONS.map((pos) => (
          <PositionSlot
            key={`ai-${pos}`}
            position={pos}
            athlete={aiLineup[pos]}
            side="ai"
            targetable={targetableAiSlots.has(pos)}
            onClick={() => onAiSlotClick(pos)}
          />
        ))}
      </div>
      <div className="cc-board__divider">
        <span>⬤ CENTER COURT ⬤</span>
      </div>
      <div className="cc-board__row">
        {POSITIONS.map((pos) => (
          <PositionSlot
            key={`player-${pos}`}
            position={pos}
            athlete={playerLineup[pos]}
            side="player"
            targetable={targetablePlayerSlots.has(pos)}
            onClick={() => onPlayerSlotClick(pos)}
          />
        ))}
      </div>
      <div className="cc-board__label cc-board__label--player">YOU</div>
    </div>
  )
}
