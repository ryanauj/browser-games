import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BEAT_MS } from './constants'
import { createInitialState, reducer } from './engine'
import { captureFrame, type DebugFrame, type DebugLog } from './debug'
import type { Action, Order, Side } from './types'

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

  // Commit a player's plan. `queue` omitted = keep the existing chain (resume);
  // `queue: []` = clear it; a non-empty array REPLACES it (the engine clamps to the
  // shot-clock horizon, Q45). This is the seam the P3 authoring UI commits a full
  // intended (order, queue) plan through atomically — there's no granular queue-edit
  // action by design (P1 contract), so editing any link re-commits the WHOLE chain.
  const setOrder = useCallback(
    (playerId: string, order: Order, queue?: Order[]) => {
      const a: Action = { type: 'SET_ORDER', playerId, order, queue }
      record(a)
      dispatch(a)
    },
    [record],
  )

  // Toggle a side's opt-in to the salient-event halt tier (Q43) — the `Action`
  // already carries it; this is the missing hook binding. Used by the control
  // affordance to expose the human's "pause on big plays" preference.
  const setHaltPolicy = useCallback(
    (side: Side, haltOnSalient: boolean) => {
      const a: Action = { type: 'SET_HALT_POLICY', side, haltOnSalient }
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

  // --- Auto-run loop (Q44/Q48 control modes) -------------------------------
  // RUN_UNTIL_HALT fast-forwards a committed plan to the next halt (any player out
  // of plan, or an opted-in salient event) — mechanically equal to tapping Next
  // Step N times. The CONTROL MODES wrap it in a self-perpetuating loop: each tick
  // dispatches one RUN_UNTIL_HALT, opens a glide window, then schedules the next
  // tick — so the floor keeps advancing through halts until something stops it.
  // Both modes use the same primitive: always-on auto-advance toggles it on/off;
  // opt-in fast-forward holds it on while a button is pressed. Editing a player
  // (or hitting Stop) calls stopAutoRun — the drag-to-edit interrupt.
  const [autoRunning, setAutoRunning] = useState(false)
  const runningRef = useRef(false)
  const autoTimer = useRef<number | null>(null)
  // Latest phase, read inside the loop tick without re-subscribing the callback.
  const phaseRef = useRef(state.phase)
  useEffect(() => {
    phaseRef.current = state.phase
  }, [state.phase])

  const stopAutoRun = useCallback(() => {
    runningRef.current = false
    setAutoRunning(false)
    if (autoTimer.current) {
      window.clearTimeout(autoTimer.current)
      autoTimer.current = null
    }
  }, [])

  const startAutoRun = useCallback(() => {
    if (runningRef.current || phaseRef.current !== 'play') return
    runningRef.current = true
    setAutoRunning(true)
    const tick = () => {
      if (!runningRef.current) return
      if (phaseRef.current !== 'play') {
        stopAutoRun()
        return
      }
      pulse()
      const a: Action = { type: 'RUN_UNTIL_HALT' }
      record(a)
      dispatch(a)
      // Schedule the next halt after this one's glide settles. The game may end on
      // this step; the next tick re-checks the phase and stops cleanly.
      autoTimer.current = window.setTimeout(tick, beatMs)
    }
    tick()
  }, [pulse, record, beatMs, stopAutoRun])

  // Tear down the loop on unmount.
  useEffect(() => () => stopAutoRun(), [stopAutoRun])

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
    stopAutoRun()
    dispatch({ type: 'NEW_GAME' })
  }, [stopAutoRun])

  const getDebug = useCallback(
    (): DebugLog => ({ seed: seedRef.current, actions: actionsRef.current, frames: framesRef.current }),
    [],
  )

  return {
    state,
    animating,
    beatMs,
    setOrder,
    setHaltPolicy,
    runStep,
    autoRunning,
    startAutoRun,
    stopAutoRun,
    callShot,
    newGame,
    getDebug,
  }
}
