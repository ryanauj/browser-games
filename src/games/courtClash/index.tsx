import { useCallback, useEffect, useMemo, useState } from 'react'
import { POSITIONS, QUARTERS, SUB_COST } from './constants'
import { computeClash, effectiveDef, effectiveOff } from './engine'
import { useCourtClash } from './useCourtClash'
import type { PlayerState, Position } from './types'
import { Bench } from './components/Bench'
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
  'Your five are already out there. The chips on the centre line project each lane: green = you score, red = the CPU.',
  `Stamina (❤) burns every possession. Tap a bench player, then a court slot, to sub them in (${SUB_COST}⚡) before anyone gasses out.`,
  'A ⚠ chip means your defender will pick up a foul — 3 and he’s gone for the game. Sub him out, or shore up the lane with a play card.',
  'Purple cards are your playbook: a Timeout rests a star in place, Zone Defense can flip several lanes at once.',
] as const
const COACH_DONE = COACH_TIPS.length

type Selection = { kind: 'play'; id: string } | { kind: 'bench'; uid: string } | null

export default function CourtClash() {
  const game = useCourtClash()
  const { state, resolving } = game
  const player = state.players.player
  const ai = state.players.ai

  const [selection, setSelection] = useState<Selection>(null)
  const selectedPlay = useMemo(
    () => (selection?.kind === 'play' ? player.hand.find((c) => c.id === selection.id) : undefined),
    [player.hand, selection],
  )
  const selectedBench = useMemo(
    () => (selection?.kind === 'bench' ? player.bench.find((a) => a.uid === selection.uid) : undefined),
    [player.bench, selection],
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
  useEffect(() => {
    if (coachStage === 0 && state.turn > 1) advanceCoach(1)
    if (coachStage === 1 && state.turn > 3) advanceCoach(2)
    if (coachStage === 2 && state.turn > 5) advanceCoach(3)
    if (coachStage === 3 && state.turn > 8) advanceCoach(COACH_DONE)
  }, [coachStage, state.turn, advanceCoach])

  // Drop a stale selection when the item leaves hand/bench or the turn changes.
  useEffect(() => {
    if (selection?.kind === 'play' && !player.hand.some((c) => c.id === selection.id)) setSelection(null)
    if (selection?.kind === 'bench' && !player.bench.some((a) => a.uid === selection.uid)) setSelection(null)
  }, [player.hand, player.bench, selection])
  useEffect(() => {
    setSelection(null)
  }, [state.turn, state.quarter, state.phase])

  const interactive = state.phase === 'deploy' && !resolving && !helpOpen

  // Live lane projections + effective stats. Exact, because the CPU coach has
  // already committed its moves for this possession.
  const lanes = useMemo(() => computeClash(state), [state])
  const lateGame = state.quarter >= QUARTERS
  const effFor = (own: PlayerState, opp: PlayerState): EffMap => {
    const map: EffMap = {}
    for (const pos of POSITIONS) {
      const a = own.lineup[pos]
      if (a) {
        map[pos] = {
          off: effectiveOff(a, pos, own, opp.lineup[pos], lateGame),
          def: effectiveDef(a, pos),
        }
      }
    }
    return map
  }
  const playerEff = useMemo(() => effFor(player, ai), [player, ai, lateGame])
  const aiEff = useMemo(() => effFor(ai, player), [player, ai, lateGame])

  // Which slots light up depends on the selection.
  const { targetablePlayerSlots, targetableAiSlots } = useMemo(() => {
    const pSlots = new Set<Position>()
    const aSlots = new Set<Position>()
    if (interactive && selectedBench) {
      POSITIONS.forEach((pos) => pSlots.add(pos)) // sub into any slot
    } else if (interactive && selectedPlay) {
      if (selectedPlay.target === 'ally') {
        POSITIONS.forEach((pos) => {
          if (player.lineup[pos]) pSlots.add(pos)
        })
      } else if (selectedPlay.target === 'enemy') {
        POSITIONS.forEach((pos) => {
          if (ai.lineup[pos]) aSlots.add(pos)
        })
      }
    }
    return { targetablePlayerSlots: pSlots, targetableAiSlots: aSlots }
  }, [interactive, selectedBench, selectedPlay, player.lineup, ai.lineup])

  const handleSelectPlay = (cardId: string) => {
    const card = player.hand.find((c) => c.id === cardId)
    if (!card) return
    // Self / no-target plays fire immediately.
    if (card.target === 'self' || card.target === 'none') {
      game.playCard(card.id)
      setSelection(null)
      return
    }
    setSelection((cur) => (cur?.kind === 'play' && cur.id === cardId ? null : { kind: 'play', id: cardId }))
  }

  const handleSelectBench = (uid: string) => {
    setSelection((cur) => (cur?.kind === 'bench' && cur.uid === uid ? null : { kind: 'bench', uid }))
  }

  const handlePlayerSlot = (pos: Position) => {
    if (selectedBench) {
      game.sub(selectedBench.uid, pos)
    } else if (selectedPlay && selectedPlay.target === 'ally' && player.lineup[pos]) {
      game.playCard(selectedPlay.id, 'player', pos)
    }
    setSelection(null)
  }

  const handleAiSlot = (pos: Position) => {
    if (selectedPlay?.target === 'enemy' && ai.lineup[pos]) {
      game.playCard(selectedPlay.id, 'ai', pos)
      setSelection(null)
    }
  }

  const selectionHint = selectedBench
    ? `Pick a slot for ${selectedBench.card.name} — ${selectedBench.card.position} is his natural spot.`
    : selectedPlay
      ? selectedPlay.target === 'ally'
        ? 'Pick one of your athletes.'
        : selectedPlay.target === 'enemy'
          ? 'Pick an opposing athlete.'
          : ''
      : ''
  const coachTip = coachStage < COACH_DONE ? COACH_TIPS[coachStage] : null
  const hint = !interactive
    ? ''
    : selectionHint || coachTip || 'Make subs, call plays, check the lane chips, then resolve.'

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

      <div className="cc__sideline">
        <div className="cc__sideline-section">
          <div className="cc__sideline-label">BENCH</div>
          <Bench
            bench={player.bench}
            energy={player.energy}
            selectedUid={selection?.kind === 'bench' ? selection.uid : null}
            onSelect={handleSelectBench}
          />
        </div>
        <div className="cc__sideline-section">
          <div className="cc__sideline-label">PLAYBOOK</div>
          <Hand
            cards={player.hand}
            energy={player.energy}
            selectedId={selection?.kind === 'play' ? selection.id : null}
            onSelect={handleSelectPlay}
          />
        </div>
      </div>

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
