import {
  BENCH_RECOVERY,
  ENERGY_PER_POSSESSION,
  FIT_BONUS,
  FOUL_LIMIT,
  MISMATCH_PENALTY,
  QUARTERS,
  RALLY_DEFICIT,
  SUB_COST,
  THREE_POINT_MARGIN,
} from '../constants'

interface Props {
  onClose: () => void
}

/**
 * The how-to-play guide: four numbered learning steps plus a quick reference
 * for abilities. Auto-opens on first visit and stays reachable from the "?"
 * button. The shot clock is held while it is open.
 */
export function HelpModal({ onClose }: Props) {
  return (
    <div className="cc-modal" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="cc-modal__card cc-help">
        <h2 className="cc-modal__title">You're the Coach</h2>

        <ol className="cc-help__steps">
          <li>
            <strong>The goal.</strong> Outscore the CPU over {QUARTERS} quarters. Both
            teams always have five on the floor — PG, SG, SF, PF and C — and every
            possession they clash lane against lane. The CPU coach moves first, in the
            open; the chips on the centre line project each lane exactly:{' '}
            <span className="cc-help__good">green</span> = you score,{' '}
            <span className="cc-help__bad">red</span> = CPU scores, STOP = defense holds.
            An athlete scores <em>2</em> by beating the opposing DEF, or <em>3</em> on a
            blowout of +{THREE_POINT_MARGIN} or more.
          </li>
          <li>
            <strong>Manage minutes.</strong> Athletes burn stamina (❤) every possession —
            more when they're losing their lane — and at 0 they're <em>GASSED</em>,
            playing at a heavy penalty until rested. The bench recovers +{BENCH_RECOVERY}{' '}
            a possession. Tap a bench player, then a court slot, to sub ({SUB_COST}⚡).
            On-position is +{FIT_BONUS} OFF/DEF; out of position −{MISMATCH_PENALTY}.
          </li>
          <li>
            <strong>Watch the whistle.</strong> A defender blown out by +
            {THREE_POINT_MARGIN} picks up a foul — the ⚠ on a lane chip warns you before
            it happens. At {FOUL_LIMIT} fouls an athlete is out <em>for the game</em>, so
            pull players in foul trouble out of bad matchups (and Flop the other team's
            stars into early showers).
          </li>
          <li>
            <strong>Run your playbook.</strong> You get {ENERGY_PER_POSSESSION}⚡ a
            possession for subs and play cards: boost a scorer, call a Timeout to rest a
            star in place, or shift a whole clash with Zone Defense / Full Court Press.
            Buffs last one clash. When the picture looks right, press{' '}
            <em>Resolve Clash</em>.
          </li>
        </ol>

        <h3 className="cc-help__subtitle">Abilities to watch</h3>
        <ul className="cc-help__list">
          <li><em>Playmaker</em> — +1 coach energy each possession while on court.</li>
          <li><em>Fast Break</em> — +2 OFF against a tired (≤2 STA) or missing defender.</li>
          <li><em>Clutch</em> — +2 OFF in Q{QUARTERS} and overtime.</li>
          <li><em>Hustle</em> — heats up: +1 OFF per possession on court (max +3).</li>
          <li><em>Rebound</em> — recovers stamina as fast as he burns it.</li>
          <li><em>Iron</em> — the first time he would gas out, holds at 1 STA.</li>
          <li><em>Takeover</em> — +1 OFF to all your other athletes on court.</li>
        </ul>

        <p className="cc-help__text">
          Never out of it: a team trailing by {RALLY_DEFICIT}+ <em>rallies</em> — +1
          energy and an extra play card each possession. A tie sends it to sudden-death
          overtime: the first clash that breaks the tie wins. And when you're ready for
          pressure, toggle the <em>shot clock</em> for 24 real seconds per possession,
          Clash Royale style.
        </p>

        <button type="button" className="cc-btn cc-btn--primary cc-help__close" onClick={onClose}>
          Got it — let's hoop ▶
        </button>
      </div>
    </div>
  )
}
