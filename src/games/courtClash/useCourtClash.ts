import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { SHOT_CLOCK_SECONDS } from './constants'
import { createInitialState, reducer } from './engine'
import './ai' // registers the CPU strategy with the engine (side effect)
import type { Position, Side } from './types'

/**
 * Owns the reducer state and the only real-time piece of the game: the
 * shot clock. The clock ticks once per second during the deploy phase and
 * auto-ends the possession at 0. A short `resolving` flash is exposed for the
 * UI to animate the clash without making the engine asynchronous.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [shotClock, setShotClock] = useState(SHOT_CLOCK_SECONDS)
  const [paused, setPaused] = useState(false)
  const [resolving, setResolving] = useState(false)
  const resolveTimer = useRef<number | null>(null)

  // Reset the shot clock at the start of every possession.
  useEffect(() => {
    setShotClock(SHOT_CLOCK_SECONDS)
  }, [state.turn, state.quarter, state.phase])

  const endPossession = useCallback(() => {
    if (state.phase !== 'deploy') return
    setResolving(true)
    if (resolveTimer.current) window.clearTimeout(resolveTimer.current)
    resolveTimer.current = window.setTimeout(() => setResolving(false), 850)
    dispatch({ type: 'END_POSSESSION' })
  }, [state.phase])

  // Real-time shot-clock countdown during the deploy phase.
  useEffect(() => {
    if (state.phase !== 'deploy' || paused || resolving) return
    const id = window.setInterval(() => {
      setShotClock((s) => {
        if (s <= 1) {
          window.clearInterval(id)
          endPossession()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [state.phase, state.turn, state.quarter, paused, resolving, endPossession])

  useEffect(() => () => {
    if (resolveTimer.current) window.clearTimeout(resolveTimer.current)
  }, [])

  return {
    state,
    shotClock,
    paused,
    resolving,
    togglePause: useCallback(() => setPaused((p) => !p), []),
    playAthlete: useCallback(
      (cardId: string, slot: Position) => dispatch({ type: 'PLAY_ATHLETE', cardId, slot }),
      [],
    ),
    playPowerUp: useCallback(
      (cardId: string, targetSide?: Side, targetSlot?: Position) =>
        dispatch({ type: 'PLAY_POWERUP', cardId, targetSide, targetSlot }),
      [],
    ),
    endPossession,
    advanceQuarter: useCallback(() => dispatch({ type: 'ADVANCE_QUARTER' }), []),
    newGame: useCallback(() => dispatch({ type: 'NEW_GAME' }), []),
  }
}
