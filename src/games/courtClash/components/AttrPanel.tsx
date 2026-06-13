import { ATTR_META, heatTier } from '../attributes'
import type { Player } from '../types'

/** A tap-to-open readout of a player's eight attributes, each tile colored on a
 *  cold→hot heat scale so strengths and weaknesses read at a glance — no
 *  numbers, just icon + color. Works for either team (scout the matchup). */
export function AttrPanel({ player }: { player: Player }) {
  return (
    <div className="cc-attrs">
      <div className="cc-attrs__head">
        <span className={`cc-attrs__dot cc-attrs__dot--${player.side}`} />#{player.number} {player.name}
        <span className="cc-attrs__role">{player.role}</span>
      </div>
      <div className="cc-attrs__grid">
        {ATTR_META.map((m) => (
          <div key={m.key} className={`cc-attr cc-heat-${heatTier(player.attr[m.key])}`}>
            <span className="cc-attr__icon" aria-hidden>
              {m.icon}
            </span>
            <span className="cc-attr__label">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
