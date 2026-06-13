import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BEAT_MS } from './constants'
import { createInitialState, reducer } from './engine'
import type { Order } from './types'

/**
 * Owns the reducer and the only real-time concern: the beat animation window.
 * Logical state is discrete per beat; after a RUN_BEAT / CALL_SHOT we hold an
 * `animating` flag for BEAT_MS so sprites can glide (CSS transitions) and event
 * flashes can play before the coach inputs the next beat.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [animating, setAnimating] = useState(false)
  const timer = useRef<number | null>(null)

  const pulse = useCallback(() => {
    setAnimating(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAnimating(false), BEAT_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const setOrder = useCallback((playerId: string, order: Order) => {
    dispatch({ type: 'SET_ORDER', playerId, order })
  }, [])

  const runBeat = useCallback(() => {
    if (state.phase !== 'play') return
    pulse()
    dispatch({ type: 'RUN_BEAT' })
  }, [state.phase, pulse])

  const callShot = useCallback(
    (playerId: string) => {
      if (state.phase !== 'play') return
      pulse()
      dispatch({ type: 'CALL_SHOT', playerId })
    },
    [state.phase, pulse],
  )

  const newGame = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setAnimating(false)
    dispatch({ type: 'NEW_GAME' })
  }, [])

  return { state, animating, setOrder, runBeat, callShot, newGame }
}
