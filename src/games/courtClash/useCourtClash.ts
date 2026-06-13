import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BEAT_MS } from './constants'
import { createInitialState, reducer } from './engine'
import { captureFrame, type DebugFrame, type DebugLog } from './debug'
import type { Action, Order } from './types'

/**
 * Owns the reducer and the only real-time concern: the beat animation window.
 * Also records a debug log — the seed plus every action (for exact replay) and
 * a compact snapshot per beat — that the coach can copy and send as feedback.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [animating, setAnimating] = useState(false)
  const timer = useRef<number | null>(null)

  const actionsRef = useRef<Action[]>([])
  const framesRef = useRef<DebugFrame[]>([])
  const seedRef = useRef<number>(state.seed)

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

  // Snapshot a frame whenever a beat advances or a possession resolves. On a
  // new game (seed change) the log starts fresh.
  useEffect(() => {
    if (state.seed !== seedRef.current) {
      seedRef.current = state.seed
      actionsRef.current = []
      framesRef.current = []
    }
    framesRef.current.push(captureFrame(state))
  }, [state.beat, state.possession, state.seed])

  const record = useCallback((a: Action) => {
    actionsRef.current.push(a)
  }, [])

  const setOrder = useCallback(
    (playerId: string, order: Order) => {
      const a: Action = { type: 'SET_ORDER', playerId, order }
      record(a)
      dispatch(a)
    },
    [record],
  )

  const runBeat = useCallback(() => {
    if (state.phase !== 'play') return
    pulse()
    const a: Action = { type: 'RUN_BEAT' }
    record(a)
    dispatch(a)
  }, [state.phase, pulse, record])

  const callShot = useCallback(
    (playerId: string) => {
      if (state.phase !== 'play') return
      pulse()
      const a: Action = { type: 'CALL_SHOT', playerId }
      record(a)
      dispatch(a)
    },
    [state.phase, pulse, record],
  )

  const newGame = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setAnimating(false)
    dispatch({ type: 'NEW_GAME' })
  }, [])

  const getDebug = useCallback(
    (): DebugLog => ({ seed: seedRef.current, actions: actionsRef.current, frames: framesRef.current }),
    [],
  )

  return { state, animating, setOrder, runBeat, callShot, newGame, getDebug }
}
