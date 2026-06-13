import { ATTR_META, heatTier } from '../attributes'
import type { Player } from '../types'

/** A tap-to-open readout of a player's eight attributes: icon + label + the raw
 *  0–99 value, with the value chip colored green (strong) → red (weak) to match
 *  the risk glow. Works for either team (scout the matchup). */
export function AttrPanel({ player }: { player: Player }) {
  return (
    <div className="cc-attrs">
      <div className="cc-attrs__head">
        <span className={`cc-attrs__dot cc-attrs__dot--${player.side}`} />#{player.number} {player.name}
        <span className="cc-attrs__role">{player.role}</span>
      </div>
      <div className="cc-attrs__grid">
        {ATTR_META.map((m) => {
          const v = player.attr[m.key]
          return (
            <div key={m.key} className="cc-attr">
              <span className="cc-attr__icon" aria-hidden>
                {m.icon}
              </span>
              <span className="cc-attr__label">{m.label}</span>
              <span className={`cc-attr__val cc-grade-${heatTier(v)}`}>{v}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
