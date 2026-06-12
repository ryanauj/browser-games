interface Props {
  energy: number
}

/** Shows the coach's energy (spent on subs and plays) as a row of pips. */
export function EnergyBar({ energy }: Props) {
  const shown = Math.max(energy, 0)
  return (
    <div className="cc-energy" title={`${energy} coach energy — subs cost 1, plays show their cost`}>
      <span className="cc-energy__label">COACH ⚡</span>
      <span className="cc-energy__pips">
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="cc-energy__pip" />
        ))}
      </span>
      <span className="cc-energy__count">{energy}</span>
    </div>
  )
}
