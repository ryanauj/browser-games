import { SHOT_CLOCK_BEATS, WIN_TARGET } from '../constants'

interface Props {
  onClose: () => void
}

/**
 * The how-to-play guide for The Floor General. Auto-opens on first visit and
 * stays reachable from the "?" button.
 */
export function HelpModal({ onClose }: Props) {
  return (
    <div className="cc-modal" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="cc-modal__card cc-help">
        <h2 className="cc-modal__title">You're the Floor General</h2>

        <ol className="cc-help__steps">
          <li>
            <strong>Orchestrate the floor.</strong> Half-court 5v5. You direct all five of
            your players, beat by beat. <em>Drag</em> a player onto a spot or another
            player and a quick action wheel pops up — Move, Screen, Pass, Guard and
            so on, depending on where you drop. Or <em>tap</em> a player for the same
            actions as a menu. Set as many orders as you like,
            then press <em>Run Beat ▶</em> to advance time ~1 second and watch it play out.
            Orders persist until you change them, so you only touch who you want. Tap any
            player — yours or the CPU's — to scout their ratings: each badge shows a
            standout skill, and the panel shows all eight 0–99 stats,{' '}
            <span className="cc-help__good">green</span> (strong) to{' '}
            <span className="cc-help__bad">red</span> (weak). The solid blue ring on a
            selected player is how far they jog (a <em>move</em>) this beat; the dashed
            outer ring is the farther <em>burst</em> a <em>cut</em> or <em>drive</em>
            reaches — it covers more ground but burns more stamina.
          </li>
          <li>
            <strong>Get someone open.</strong> Openness is everything — a wide-open role
            player beats a covered star. Plant a <em>screen</em> at a spot and any defender
            who runs through it gets hung up for a beat — springing their man. Use screens,
            cuts and passes to get someone open, then tap your ball handler and hit{' '}
            <em>Shoot</em>. A <em>drive</em> gets downhill and gives your next shot a
            finishing boost — but a defender in your path can strip it. The ring around the ball tells you
            the look: <span className="cc-help__good">green</span> good,{' '}
            <span className="cc-help__bad">red</span> bad. Inside the arc is 2, beyond it 3.
          </li>
          <li>
            <strong>Lock down on defense.</strong> When the CPU has it, run your five:{' '}
            <em>Guard</em> (or switch) a man, <em>Double</em> the ball, <em>Help</em> into
            the lane, or <em>Steal</em> for a gamble. Force a miss, a steal, or run the{' '}
            <em>{SHOT_CLOCK_BEATS}-beat shot clock</em> out for a turnover.
          </li>
          <li>
            <strong>Ride your five.</strong> Moving burns stamina; a gassed player slows
            down and can't sprint. Pick your moments — you can't crash all five every beat.
            Stamina recovers at every check-up.
          </li>
        </ol>

        <p className="cc-help__text">
          First team to <strong>{WIN_TARGET}</strong> (win by 2) takes it. Possession
          alternates after every made basket. Go get a bucket.
        </p>

        <button type="button" className="cc-btn cc-btn--primary cc-help__close" onClick={onClose}>
          Got it — let's hoop ▶
        </button>
      </div>
    </div>
  )
}
