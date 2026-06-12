import { POSITIONS } from '../constants'
import type { LaneOutcome } from '../engine'
import type { Lineup, Position } from '../types'
import { PositionSlot } from './PositionSlot'

/** Effective OFF/DEF per occupied slot, computed by the container. */
export type EffMap = Partial<Record<Position, { off: number; def: number }>>

interface Props {
  playerLineup: Lineup
  aiLineup: Lineup
  playerEff: EffMap
  aiEff: EffMap
  lanes: LaneOutcome[]
  targetablePlayerSlots: Set<Position>
  targetableAiSlots: Set<Position>
  onPlayerSlotClick: (pos: Position) => void
  onAiSlotClick: (pos: Position) => void
}

/** Centre-line chip projecting one lane's outcome if the clash ran now. */
function LaneChip({ lane }: { lane: LaneOutcome }) {
  const { playerPts: p, aiPts: a, playerHas, aiHas } = lane
  let cls = 'cc-chip--idle'
  let text = '·'
  if (p > 0 && a > 0) {
    cls = 'cc-chip--trade'
    text = `+${p} / +${a}`
  } else if (p > 0) {
    cls = 'cc-chip--good'
    text = `+${p}`
  } else if (a > 0) {
    cls = 'cc-chip--bad'
    text = `+${a}`
  } else if (playerHas && aiHas) {
    cls = 'cc-chip--stop'
    text = 'STOP'
  }
  const foulNote = lane.playerFoul ? ' Your defender picks up a foul!' : ''
  const cpuFoulNote = lane.aiFoul ? ' The CPU defender picks up a foul.' : ''
  const title =
    `${lane.pos} projection — you +${p}, CPU +${a}.` +
    (lane.playerDrain || lane.aiDrain
      ? ` Stamina: you −${lane.playerDrain}, CPU −${lane.aiDrain}.`
      : '') +
    foulNote +
    cpuFoulNote
  return (
    <span className={`cc-chip ${cls}`} title={title} aria-label={title}>
      {text}
      {lane.playerFoul && <span className="cc-chip__foul">⚠</span>}
    </span>
  )
}

/** The court: CPU five on top, lane projections in the middle, your five below. */
export function Board({
  playerLineup,
  aiLineup,
  playerEff,
  aiEff,
  lanes,
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
            eff={aiEff[pos]}
            side="ai"
            targetable={targetableAiSlots.has(pos)}
            onClick={() => onAiSlotClick(pos)}
          />
        ))}
      </div>
      <div className="cc-board__divider">
        {lanes.map((lane) => (
          <LaneChip key={lane.pos} lane={lane} />
        ))}
      </div>
      <div className="cc-board__row">
        {POSITIONS.map((pos) => (
          <PositionSlot
            key={`player-${pos}`}
            position={pos}
            athlete={playerLineup[pos]}
            eff={playerEff[pos]}
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
