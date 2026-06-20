import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BEAT_MS } from './constants'
import { createInitialState, reducer } from './engine'
import { captureFrame, type DebugFrame, type DebugLog } from './debug'
import type { Action, Order } from './types'

/**
 * Owns the reducer plus the per-step animation window and the debug log (seed +
 * every action for exact replay, and a compact snapshot per step).
 *
 * The game is turn-based by STEP (Q10/Q11 — tap per step): between steps you set
 * any subset of your five's orders, then advance ONE step at a time (runStep /
 * callShot). Each advance opens a short animation window during which sprites
 * glide to their new spots — then everything settles and nothing moves until you
 * advance again. Untouched players continue toward their target then hold (Q12),
 * so a committed sprint keeps building speed without re-tapping. BEAT_MS survives
 * only as that glide duration, not as a unit of game time.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [pulsing, setPulsing] = useState(false)
  const timer = useRef<number | null>(null)

  // One step's worth of glide; also drives the --cc-beat CSS transition.
  const beatMs = BEAT_MS

  const actionsRef = useRef<Action[]>([])
  const framesRef = useRef<DebugFrame[]>([])
  const seedRef = useRef<number>(state.seed)

  // The court animates only during the brief window right after an advance.
  const animating = pulsing

  const pulse = useCallback(() => {
    setPulsing(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPulsing(false), beatMs)
  }, [beatMs])

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
  }, [state.step, state.possession, state.seed])

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

  // Advance exactly one step (Q11 tap-per-step). Ignored while a step is still
  // gliding so you can't accidentally double-step.
  const runStep = useCallback(() => {
    if (state.phase !== 'play' || pulsing) return
    pulse()
    const a: Action = { type: 'RUN_STEP' }
    record(a)
    dispatch(a)
  }, [state.phase, pulsing, pulse, record])

  const callShot = useCallback(
    (playerId: string) => {
      if (state.phase !== 'play' || pulsing) return
      pulse()
      const a: Action = { type: 'CALL_SHOT', playerId }
      record(a)
      dispatch(a)
    },
    [state.phase, pulsing, pulse, record],
  )

  const newGame = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setPulsing(false)
    dispatch({ type: 'NEW_GAME' })
  }, [])

  const getDebug = useCallback(
    (): DebugLog => ({ seed: seedRef.current, actions: actionsRef.current, frames: framesRef.current }),
    [],
  )

  return {
    state,
    animating,
    beatMs,
    setOrder,
    runStep,
    callShot,
    newGame,
    getDebug,
  }
}
