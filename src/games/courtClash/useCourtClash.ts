import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BEAT_MS } from './constants'
import { createInitialState, reducer } from './engine'
import { captureFrame, type DebugFrame, type DebugLog } from './debug'
import type { Action, Order } from './types'

/** Playback speeds (multiplier on the beat clock). */
export const SPEEDS = [0.5, 1, 2] as const
export type Speed = (typeof SPEEDS)[number]

/** Any beat event except a completed pass halts real-time play so the coach can
 *  redraw — i.e. turnovers/steals and shots/rebounds (the resolution moments). */
const isPauseEvent = (kind: string): boolean => kind !== 'pass'

/**
 * Owns the reducer plus the real-time concerns: a play/pause clock that
 * auto-advances beats, the per-beat animation window, and the debug log (seed +
 * every action for exact replay, and a compact snapshot per beat).
 *
 * Real-time model: while `playing`, beats fire every `beatMs` (scaled by speed).
 * Play auto-pauses on a resolution event (turnover/steal/shot/rebound) so you
 * can redraw; the CPU re-plans every beat, so a pause never grants free micro.
 */
export function useCourtClash() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState())
  const [pulsing, setPulsing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const timer = useRef<number | null>(null)

  const beatMs = Math.round(BEAT_MS / speed)
  const beatMsRef = useRef(beatMs)
  beatMsRef.current = beatMs

  const actionsRef = useRef<Action[]>([])
  const framesRef = useRef<DebugFrame[]>([])
  const seedRef = useRef<number>(state.seed)

  // The court is "animating" continuously while playing, and for one beat after
  // a manual step/shot while paused.
  const animating = playing || pulsing

  const pulse = useCallback(() => {
    setPulsing(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPulsing(false), beatMsRef.current)
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

  // Always call the latest runBeat from the real-time loop without re-arming it
  // on every render.
  const runBeatRef = useRef(runBeat)
  runBeatRef.current = runBeat

  // Real-time loop: while playing, schedule the next beat. Re-arms whenever a
  // beat/possession advances, so it chains continuously.
  useEffect(() => {
    if (!playing || state.phase !== 'play') return
    const id = window.setTimeout(() => runBeatRef.current(), beatMs)
    return () => window.clearTimeout(id)
  }, [playing, state.beat, state.possession, state.phase, beatMs])

  // Auto-pause on a resolution event (or game over). Keyed on events only, so
  // hitting Play again doesn't immediately re-pause on the same stale event.
  useEffect(() => {
    if (state.phase !== 'play') {
      setPlaying(false)
      return
    }
    if (state.events.some((e) => isPauseEvent(e.kind))) setPlaying(false)
  }, [state.events, state.phase])

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

  const togglePlay = useCallback(() => setPlaying((p) => !p), [])
  const pause = useCallback(() => setPlaying(false), [])

  const newGame = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setPulsing(false)
    setPlaying(false)
    dispatch({ type: 'NEW_GAME' })
  }, [])

  const getDebug = useCallback(
    (): DebugLog => ({ seed: seedRef.current, actions: actionsRef.current, frames: framesRef.current }),
    [],
  )

  return {
    state,
    animating,
    playing,
    speed,
    beatMs,
    setOrder,
    runBeat,
    callShot,
    togglePlay,
    pause,
    setSpeed,
    newGame,
    getDebug,
  }
}
