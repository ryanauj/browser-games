import { useCallback, useEffect, useMemo, useState } from 'react'
import { POSITIONS, QUARTERS } from './constants'
import { computeClash, effectiveDef, effectiveOff } from './engine'
import { useCourtClash } from './useCourtClash'
import type { Card, PlayerState, Position } from './types'
import { Board, type EffMap } from './components/Board'
import { EnergyBar } from './components/EnergyBar'
import { GameLog } from './components/GameLog'
import { GameOverModal } from './components/GameOverModal'
import { Hand } from './components/Hand'
import { HelpModal } from './components/HelpModal'
import { Scoreboard } from './components/Scoreboard'
import { ShotClock } from './components/ShotClock'
import './courtClash.css'

const HELP_SEEN_KEY = 'courtclash-help-seen'
const COACH_KEY = 'courtclash-coach'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable — onboarding just repeats next visit
  }
}

/** Staged first-game tips. Stage advances with play; ✕ dismisses for good. */
const COACH_TIPS = [
  'Tap an athlete card below, then a glowing slot. Matching its position (PG → PG) gives +2 OFF and +2 DEF.',
  'The chips on the centre line project each lane: green = you score, red = the CPU scores. Happy? Press Resolve Clash ▶.',
  'Purple cards are power-ups. A Clutch Gene or Zone Defense can flip a losing lane before you resolve.',
  'Athletes wear down: stamina (❤) drops by the attacker’s OFF minus your DEF each clash. At 0 they foul out.',
] as const
const COACH_DONE = COACH_TIPS.length

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

  // Onboarding: auto-open the guide on first visit; hold the clock while open.
  const [helpOpen, setHelpOpen] = useState(() => readStored(HELP_SEEN_KEY) !== '1')
  useEffect(() => {
    game.setHold(helpOpen)
  }, [helpOpen, game.setHold])
  const closeHelp = useCallback(() => {
    writeStored(HELP_SEEN_KEY, '1')
    setHelpOpen(false)
  }, [])

  // Coach tips: one short staged hint at a time during the first games.
  const [coachStage, setCoachStage] = useState(() => {
    const n = Number(readStored(COACH_KEY) ?? '0')
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), COACH_DONE) : 0
  })
  const advanceCoach = useCallback((to: number) => {
    setCoachStage((cur) => {
      const next = Math.max(cur, Math.min(to, COACH_DONE))
      if (next !== cur) writeStored(COACH_KEY, String(next))
      return next
    })
  }, [])
  const playerHasAthlete = POSITIONS.some((pos) => player.lineup[pos] !== null)
  useEffect(() => {
    if (coachStage === 0 && playerHasAthlete) advanceCoach(1)
  }, [coachStage, playerHasAthlete, advanceCoach])
  useEffect(() => {
    if (coachStage === 1 && state.turn > 1) advanceCoach(2)
    if (coachStage === 2 && state.turn > 2) advanceCoach(3)
    if (coachStage === 3 && state.turn > 4) advanceCoach(COACH_DONE)
  }, [coachStage, state.turn, advanceCoach])

  // Drop a stale selection when the card leaves hand or the turn changes.
  useEffect(() => {
    if (selectedId && !player.hand.some((c) => c.id === selectedId)) setSelectedId(null)
  }, [player.hand, selectedId])
  useEffect(() => {
    setSelectedId(null)
  }, [state.turn, state.quarter, state.phase])

  const interactive = state.phase === 'deploy' && !resolving && !helpOpen

  // Live lane projections + effective stats. Exact, because the CPU has
  // already committed its plays for this possession.
  const lanes = useMemo(() => computeClash(state), [state])
  const lateGame = state.quarter >= QUARTERS
  const effFor = (own: PlayerState, opp: PlayerState): EffMap => {
    const map: EffMap = {}
    for (const pos of POSITIONS) {
      const a = own.lineup[pos]
      if (a) {
        map[pos] = {
          off: effectiveOff(a, own, opp.lineup[pos] === null, lateGame),
          def: effectiveDef(a),
        }
      }
    }
    return map
  }
  const playerEff = useMemo(() => effFor(player, ai), [player, ai, lateGame])
  const aiEff = useMemo(() => effFor(ai, player), [player, ai, lateGame])

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

  const selectionHint = selected
    ? selected.kind === 'athlete'
      ? selected.position && player.lineup[selected.position] === null
        ? `Pick a glowing slot — ${selected.position} is its natural spot.`
        : 'Pick a glowing slot to deploy.'
      : selected.target === 'ally'
        ? 'Pick one of your athletes.'
        : selected.target === 'enemy'
          ? 'Pick an opposing athlete.'
          : ''
    : ''
  const coachTip = coachStage < COACH_DONE ? COACH_TIPS[coachStage] : null
  const hint = !interactive
    ? ''
    : selectionHint || coachTip || 'Play cards, check the lane chips, then resolve.'

  return (
    <div className="cc">
      <header className="cc__header">
        <a className="cc__back" href="#/">
          ← Games
        </a>
        <h1 className="cc__title">Court Clash</h1>
        <div className="cc__header-actions">
          <button
            type="button"
            className="cc-btn cc-btn--icon"
            onClick={() => setHelpOpen(true)}
            aria-label="How to play"
          >
            ?
          </button>
          <button type="button" className="cc-btn" onClick={game.newGame}>
            New Game
          </button>
        </div>
      </header>

      <Scoreboard
        playerScore={player.score}
        aiScore={ai.score}
        quarter={state.quarter}
        gameClock={state.gameClock}
      />

      <div className="cc__controls">
        <ShotClock
          seconds={game.shotClock}
          timed={game.timed}
          onToggleTimed={() => game.setTimed(!game.timed)}
        />
        <EnergyBar energy={player.energy} />
        <button
          type="button"
          className="cc-btn cc-btn--primary cc__resolve"
          onClick={game.endPossession}
          disabled={!interactive}
        >
          Resolve Clash ▶
        </button>
      </div>

      <p className={`cc__hint ${resolving ? 'cc__hint--resolving' : ''} ${!selectionHint && coachTip ? 'cc__hint--coach' : ''}`}>
        {resolving ? 'Clash!' : hint}
        {interactive && !selectionHint && coachTip && (
          <button
            type="button"
            className="cc__hint-dismiss"
            onClick={() => advanceCoach(COACH_DONE)}
            aria-label="Dismiss tips"
          >
            ✕
          </button>
        )}
      </p>

      <div className="cc__main">
        <Board
          playerLineup={player.lineup}
          aiLineup={ai.lineup}
          playerEff={playerEff}
          aiEff={aiEff}
          lanes={lanes}
          targetablePlayerSlots={targetablePlayerSlots}
          targetableAiSlots={targetableAiSlots}
          onPlayerSlotClick={handlePlayerSlot}
          onAiSlotClick={handleAiSlot}
        />
        <GameLog lines={state.log} />
      </div>

      <Hand cards={player.hand} energy={player.energy} selectedId={selectedId} onSelect={handleSelect} />

      {helpOpen && <HelpModal onClose={closeHelp} />}

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
