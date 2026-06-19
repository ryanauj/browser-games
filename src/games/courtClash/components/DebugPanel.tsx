import { useState } from 'react'
import type { DebugLog } from '../debug'

/** Copyable debug trail. Lists every beat; tick any to include just those, or
 *  copy the whole game (seed + actions, so Claude can replay it exactly). */
export function DebugPanel({ getLog, onClose }: { getLog: () => DebugLog; onClose: () => void }) {
  const data = getLog()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  const build = (which: 'full' | 'selected'): string => {
    const frames = which === 'full' ? data.frames : data.frames.filter((_, i) => selected.has(i))
    return JSON.stringify({ seed: data.seed, actions: data.actions, frames }, null, 2)
  }

  const copy = async (which: 'full' | 'selected') => {
    const out = build(which)
    setText(out)
    try {
      await navigator.clipboard.writeText(out)
      setStatus(`Copied ${which === 'full' ? 'full game' : `${selected.size} beat(s)`} — ${out.length} chars`)
    } catch {
      setStatus('Clipboard blocked — select the text below and copy manually')
    }
  }

  const toggle = (i: number) =>
    setSelected((cur) => {
      const next = new Set(cur)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  return (
    <div className="cc-modal" role="dialog" aria-modal="true" aria-label="Debug log">
      <div className="cc-modal__card cc-debug">
        <h2 className="cc-modal__title">Debug log</h2>
        <p className="cc-debug__meta">
          seed {data.seed} · {data.frames.length} steps · {data.actions.length} actions
        </p>

        <div className="cc-debug__actions">
          <button type="button" className="cc-btn cc-btn--primary" onClick={() => copy('full')}>
            Copy full game
          </button>
          <button type="button" className="cc-btn" disabled={selected.size === 0} onClick={() => copy('selected')}>
            Copy selected ({selected.size})
          </button>
          <button type="button" className="cc-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {status && <p className="cc-debug__status">{status}</p>}

        <div className="cc-debug__frames">
          {data.frames.map((f, i) => (
            <label key={i} className="cc-debug__frame">
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              <span className="cc-debug__frame-id">
                S{f.step}·P{f.possession}
              </span>
              <span className="cc-debug__frame-tag">{f.offense === 'player' ? 'OFF' : 'DEF'}</span>
              <span className="cc-debug__frame-score">
                {f.score.player}-{f.score.ai}
              </span>
              <span className="cc-debug__frame-ev">{f.events.join(' ') || '—'}</span>
            </label>
          ))}
        </div>

        <textarea
          className="cc-debug__text"
          readOnly
          value={text}
          placeholder="Copied JSON appears here — long-press to select if the copy button is blocked."
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </div>
  )
}
