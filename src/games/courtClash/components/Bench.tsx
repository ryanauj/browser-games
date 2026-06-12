import { BENCH_RECOVERY, FOUL_LIMIT, SUB_COST } from '../constants'
import type { RosterAthlete } from '../types'

interface Props {
  bench: RosterAthlete[]
  energy: number
  selectedUid: string | null
  onSelect: (uid: string) => void
}

function FoulDots({ fouls }: { fouls: number }) {
  return (
    <span className="cc-fouls" title={`${fouls}/${FOUL_LIMIT} fouls`}>
      {Array.from({ length: FOUL_LIMIT }, (_, i) => (
        <span key={i} className={i < fouls ? 'cc-fouls__dot cc-fouls__dot--on' : 'cc-fouls__dot'} />
      ))}
    </span>
  )
}

/** The bench: tap an athlete, then a court slot, to sub them in (1 energy). */
export function Bench({ bench, energy, selectedUid, onSelect }: Props) {
  if (bench.length === 0) {
    return <div className="cc-bench cc-bench--empty">Bench is empty.</div>
  }
  return (
    <div className="cc-bench">
      {bench.map((a) => {
        const resting = a.sta < a.card.sta
        const classes = ['cc-card', 'cc-card--bench']
        if (a.uid === selectedUid) classes.push('cc-card--selected')
        if (energy < SUB_COST) classes.push('cc-card--disabled')
        return (
          <button
            key={a.uid}
            type="button"
            className={classes.join(' ')}
            onClick={() => onSelect(a.uid)}
            disabled={energy < SUB_COST}
            aria-pressed={a.uid === selectedUid}
          >
            <span className="cc-card__cost" title={`Sub in for ${SUB_COST} energy`}>
              {SUB_COST}
            </span>
            <span className="cc-card__name">{a.card.name}</span>
            <span className="cc-card__pos">{a.card.position}</span>
            <span className="cc-card__stats">
              <span title="Offense">⚡{a.card.off}</span>
              <span title="Defense">🛡{a.card.def}</span>
              <span title="Stamina">
                ❤{a.sta}/{a.card.sta}
              </span>
            </span>
            <span className="cc-card__meta">
              <FoulDots fouls={a.fouls} />
              {resting && <span className="cc-card__resting">resting +{BENCH_RECOVERY}</span>}
            </span>
            {a.card.abilityText && <span className="cc-card__ability">{a.card.abilityText}</span>}
          </button>
        )
      })}
    </div>
  )
}
