import { FIT_BONUS, MISMATCH_PENALTY, QUARTERS, THREE_POINT_MARGIN } from '../constants'

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
        <h2 className="cc-modal__title">How to Play</h2>

        <ol className="cc-help__steps">
          <li>
            <strong>The goal.</strong> Outscore the CPU over {QUARTERS} quarters. Each
            possession, both teams clash across five lanes — PG, SG, SF, PF and C.
          </li>
          <li>
            <strong>Build your five.</strong> Tap an athlete card, then a glowing slot.
            Cards cost <em>energy</em> (the orange pips), which refills and grows each
            possession. Playing an athlete in its own position grants{' '}
            <em>
              +{FIT_BONUS} OFF / +{FIT_BONUS} DEF
            </em>
            ; out of position costs −{MISMATCH_PENALTY} of each.
          </li>
          <li>
            <strong>Read the lanes.</strong> The CPU plays first, in the open. The chips
            on the centre line project each lane: <span className="cc-help__good">green</span>{' '}
            means you score, <span className="cc-help__bad">red</span> means the CPU scores,
            STOP means the defense holds. Rearrange with power-ups until you like the
            picture, then press <em>Resolve Clash</em>.
          </li>
          <li>
            <strong>The clash.</strong> In each lane, an athlete scores <em>2 points</em> if
            its OFF beats the opposing DEF, or <em>3 points</em> on a blowout of +
            {THREE_POINT_MARGIN} or more. An empty opposing lane concedes an easy 2 —
            cover your lanes! Athletes also
            wear each other down: in a contested lane each takes stamina damage equal to
            the opponent's OFF minus their own DEF (minimum 1). At 0 stamina they foul
            out — the card cycles to the bottom of your deck, fresh for later.
          </li>
        </ol>

        <h3 className="cc-help__subtitle">Power-ups (purple cards)</h3>
        <p className="cc-help__text">
          One-shot plays: boost a scorer, restore stamina, damage an opponent, or shift a
          whole clash with Zone Defense / Full Court Press. Buffs last one clash.
        </p>

        <h3 className="cc-help__subtitle">Abilities to watch</h3>
        <ul className="cc-help__list">
          <li><em>Playmaker</em> — +1 energy each possession while on court.</li>
          <li><em>Fast Break</em> — +2 OFF against an empty lane.</li>
          <li><em>Clutch</em> — +2 OFF in Q{QUARTERS} and overtime.</li>
          <li><em>Hustle</em> — +1 OFF for every possession survived.</li>
          <li><em>Rebound</em> — recovers 1 stamina each possession.</li>
          <li><em>Iron</em> — survives its first foul-out at 1 stamina.</li>
          <li><em>Takeover</em> — +1 OFF to all your other athletes.</li>
        </ul>

        <p className="cc-help__text">
          Never out of it: a team trailing by 10+ <em>rallies</em>, drawing an extra card
          each possession. And when you're ready for pressure, toggle the{' '}
          <em>shot clock</em> for 24 real seconds per possession, Clash Royale style.
        </p>

        <button type="button" className="cc-btn cc-btn--primary cc-help__close" onClick={onClose}>
          Got it — let's hoop ▶
        </button>
      </div>
    </div>
  )
}
