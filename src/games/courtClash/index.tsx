import { useEffect, useMemo, useState } from 'react'
import { POSITIONS } from './constants'
import { useCourtClash } from './useCourtClash'
import type { Card, Position } from './types'
import { Board } from './components/Board'
import { EnergyBar } from './components/EnergyBar'
import { GameLog } from './components/GameLog'
import { GameOverModal } from './components/GameOverModal'
import { Hand } from './components/Hand'
import { Scoreboard } from './components/Scoreboard'
import { ShotClock } from './components/ShotClock'
import './courtClash.css'

export default function CourtClash() {
  const game = useCourtClash()
  const { state, resolving } = game
  const player = state.players.player
  const ai = state.players.ai

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected: Card | undefined = useMemo(
    () => player.hand.find((c) => c.id === selectedId),
    [player.hand, selectedId],
  )

  // Drop a stale selection when the card leaves hand or the turn changes.
  useEffect(() => {
    if (selectedId && !player.hand.some((c) => c.id === selectedId)) setSelectedId(null)
  }, [player.hand, selectedId])
  useEffect(() => {
    setSelectedId(null)
  }, [state.turn, state.quarter, state.phase])

  const interactive = state.phase === 'deploy' && !resolving

  // Which slots light up depends on the selected card.
  const { targetablePlayerSlots, targetableAiSlots } = useMemo(() => {
    const pSlots = new Set<Position>()
    const aSlots = new Set<Position>()
    if (interactive && selected) {
      if (selected.kind === 'athlete') {
        POSITIONS.forEach((pos) => {
          if (!player.lineup[pos]) pSlots.add(pos)
        })
      } else if (selected.target === 'ally') {
        POSITIONS.forEach((pos) => {
          if (player.lineup[pos]) pSlots.add(pos)
        })
      } else if (selected.target === 'enemy') {
        POSITIONS.forEach((pos) => {
          if (ai.lineup[pos]) aSlots.add(pos)
        })
      }
    }
    return { targetablePlayerSlots: pSlots, targetableAiSlots: aSlots }
  }, [interactive, selected, player.lineup, ai.lineup])

  const handleSelect = (cardId: string) => {
    const card = player.hand.find((c) => c.id === cardId)
    if (!card) return
    // Self / no-target power-ups fire immediately.
    if (card.kind === 'powerup' && (card.target === 'self' || card.target === 'none')) {
      game.playPowerUp(card.id)
      setSelectedId(null)
      return
    }
    setSelectedId((cur) => (cur === cardId ? null : cardId))
  }

  const handlePlayerSlot = (pos: Position) => {
    if (!selected) return
    if (selected.kind === 'athlete' && !player.lineup[pos]) {
      game.playAthlete(selected.id, pos)
    } else if (selected.kind === 'powerup' && selected.target === 'ally' && player.lineup[pos]) {
      game.playPowerUp(selected.id, 'player', pos)
    }
    setSelectedId(null)
  }

  const handleAiSlot = (pos: Position) => {
    if (selected?.kind === 'powerup' && selected.target === 'enemy' && ai.lineup[pos]) {
      game.playPowerUp(selected.id, 'ai', pos)
      setSelectedId(null)
    }
  }

  const hint = !interactive
    ? ''
    : selected
      ? selected.kind === 'athlete'
        ? 'Pick a glowing slot to deploy.'
        : selected.target === 'ally'
          ? 'Pick one of your athletes.'
          : selected.target === 'enemy'
            ? 'Pick an opposing athlete.'
            : ''
      : 'Select a card to play.'

  return (
    <div className="cc">
      <header className="cc__header">
        <a className="cc__back" href="#/">
          ← Games
        </a>
        <h1 className="cc__title">Court Clash</h1>
        <button type="button" className="cc-btn" onClick={game.newGame}>
          New Game
        </button>
      </header>

      <Scoreboard
        playerScore={player.score}
        aiScore={ai.score}
        quarter={state.quarter}
        gameClock={state.gameClock}
      />

      <div className="cc__controls">
        <ShotClock seconds={game.shotClock} paused={game.paused} onTogglePause={game.togglePause} />
        <EnergyBar energy={player.energy} />
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={game.endPossession}
          disabled={!interactive}
        >
          End Possession ▶
        </button>
      </div>

      <p className={`cc__hint ${resolving ? 'cc__hint--resolving' : ''}`}>
        {resolving ? 'Clash!' : hint}
      </p>

      <div className="cc__main">
        <Board
          playerLineup={player.lineup}
          aiLineup={ai.lineup}
          targetablePlayerSlots={targetablePlayerSlots}
          targetableAiSlots={targetableAiSlots}
          onPlayerSlotClick={handlePlayerSlot}
          onAiSlotClick={handleAiSlot}
        />
        <GameLog lines={state.log} />
      </div>

      <Hand cards={player.hand} energy={player.energy} selectedId={selectedId} onSelect={handleSelect} />

      {state.phase === 'quarterBreak' && (
        <div className="cc-modal">
          <div className="cc-modal__card">
            <h2 className="cc-modal__title">{state.log[0]}</h2>
            <p className="cc-modal__score">
              YOU {player.score} — {ai.score} CPU
            </p>
            <button type="button" className="cc-btn cc-btn--primary" onClick={game.advanceQuarter}>
              Tip Off ▶
            </button>
          </div>
        </div>
      )}

      {state.phase === 'gameover' && state.winner && (
        <GameOverModal
          winner={state.winner}
          playerScore={player.score}
          aiScore={ai.score}
          onNewGame={game.newGame}
        />
      )}
    </div>
  )
}
