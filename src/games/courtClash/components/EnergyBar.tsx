import { MAX_ENERGY } from '../constants'

interface Props {
  energy: number
}

/** Shows the player's available energy as a row of pips. */
export function EnergyBar({ energy }: Props) {
  const shown = Math.min(MAX_ENERGY, Math.max(energy, 0))
  return (
    <div className="cc-energy" title={`${energy} energy`}>
      <span className="cc-energy__label">ENERGY</span>
      <span className="cc-energy__pips">
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="cc-energy__pip" />
        ))}
      </span>
      <span className="cc-energy__count">{energy}</span>
    </div>
  )
}
