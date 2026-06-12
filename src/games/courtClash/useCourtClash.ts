import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { SHOT_CLOCK_SECONDS } from './constants'
import { createInitialState, reducer } from './engine'
import './ai' // registers the CPU strategy with the engine (side effect)
import type { Position, Side } from './types'

const TIMED_KEY = 'courtclash-timed'

function readTimedPreference(): boolean {
  try {
    return localStorage.getItem(TIMED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Owns the reducer state and the only real-time piece of the game: the
 * shot clock. The clock is opt-in ("timed mode") so new players can learn at
 * their own pace; when on, it ticks once per second during the deploy phase
 * and auto-ends the possession at 0. `hold` freezes it while an overlay (e.g.
 * the how-to-play guide) is open. A short `resolving` flash is exposed for
 * the UI to animate the clash without making the engine asynchronous.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [shotClock, setShotClock] = useState(SHOT_CLOCK_SECONDS)
  const [timed, setTimedState] = useState(readTimedPreference)
  const [hold, setHold] = useState(false)
  const [resolving, setResolving] = useState(false)
  const resolveTimer = useRef<number | null>(null)

  const setTimed = useCallback((on: boolean) => {
    setTimedState(on)
    try {
      localStorage.setItem(TIMED_KEY, on ? '1' : '0')
    } catch {
      // storage unavailable (private mode) — preference just won't persist
    }
  }, [])

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

  // Real-time shot-clock countdown during the deploy phase (timed mode only).
  useEffect(() => {
    if (!timed || hold || state.phase !== 'deploy' || resolving) return
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
  }, [timed, hold, state.phase, state.turn, state.quarter, resolving, endPossession])

  useEffect(() => () => {
    if (resolveTimer.current) window.clearTimeout(resolveTimer.current)
  }, [])

  return {
    state,
    shotClock,
    timed,
    setTimed,
    setHold,
    resolving,
    playCard: useCallback(
      (cardId: string, targetSide?: Side, targetSlot?: Position) =>
        dispatch({ type: 'PLAY_CARD', cardId, targetSide, targetSlot }),
      [],
    ),
    sub: useCallback(
      (benchUid: string, slot: Position) => dispatch({ type: 'SUB', benchUid, slot }),
      [],
    ),
    endPossession,
    advanceQuarter: useCallback(() => dispatch({ type: 'ADVANCE_QUARTER' }), []),
    newGame: useCallback(() => dispatch({ type: 'NEW_GAME' }), []),
  }
}
