import { SHOT_CLOCK_STEPS, WIN_TARGET } from '../constants'

interface Props {
  onClose: () => void
}

/**
 * The how-to-play guide for The Floor General. Auto-opens on first visit and
 * stays reachable from the "?" button. Skimmable: a 3-step quick start up top,
 * then short sections you can dip into — not a wall of text.
 */
export function HelpModal({ onClose }: Props) {
  return (
    <div className="cc-modal" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="cc-modal__card cc-help">
        <h2 className="cc-modal__title">You're the Floor General</h2>
        <p className="cc-help__lead">
          Half-court 5v5. You direct all five of your players, <strong>one step at a time</strong>.
        </p>

        <div className="cc-help__quick">
          <span className="cc-help__quick-label">Quick start</span>
          <ol>
            <li>
              <em>Drag</em> a player to a spot to plan a <em>Move</em> there — a planner opens, where you can add more
              steps or hit <em>✓</em> to lock it in. <em>Tap</em> them first to make that first step a Screen, Sprint or
              Pass instead.
            </li>
            <li>
              Set orders for any of your five (they stick until you change them), then press <em>▶ Next Step</em>.
              Untouched players keep heading to their target, then hold.
            </li>
            <li>
              To shoot, drag your ball handler onto the <em>hoop</em> — or tap them and hit <em>Shoot</em> — when the
              ring around the ball glows <span className="cc-help__good">green</span>.
            </li>
          </ol>
        </div>

        <h3 className="cc-help__h">🏀 Offense — get someone open</h3>
        <p className="cc-help__sec">
          Openness is everything: a wide-open role player beats a covered star. Use <em>Pass</em> and{' '}
          <em>Sprint</em> (attack the rim with the ball, or break open off it), and set a <em>Screen</em> — tap a player,
          pick Screen, then drag or tap the spot on the court. Your screener plants on that floor spot, hanging up any
          defender who runs into it for a step or two (watch for the 💥). A sprint to the rim
          gets downhill for a finishing boost, but defenders clogging your lane <em>slow it down</em> — a wall of
          bodies bottles it up (you'll see “Bottled up!”), so attack a gap or kick it out, and a defender right on you
          can still strip it. The ring on the ball is your shot quality:{' '}
          <span className="cc-help__good">green</span> good, <span className="cc-help__bad">red</span>{' '}
          bad. Inside the arc is 2, beyond it 3.
        </p>
        <p className="cc-help__sec">
          <strong>Hit a cutter in stride:</strong> send a teammate on a <em>Sprint</em>, then tap the ball handler, pick{' '}
          <em>🎯 Pass</em>, and drop it on the open spot <em>ahead</em> of them. The nearest teammate runs onto it and
          catches it on the move — a give-and-go to the rim. You choose their next move once they gather it.
        </p>

        <h3 className="cc-help__h">🛡️ Defense — lock down</h3>
        <p className="cc-help__sec">
          Drag a player onto an opponent to <em>Guard</em> (or switch), <em>Double</em> the ball, or <em>Steal</em>{' '}
          (a gamble) — or drag to a spot to <em>Move</em> into help (tap → <em>Sprint</em> to commit to a cutoff). Force a
          miss or a steal, or run the{' '}
          <em>{SHOT_CLOCK_STEPS}-step shot clock</em> out for a turnover.
        </p>

        <h3 className="cc-help__h">🔎 Reading players</h3>
        <p className="cc-help__sec">
          Tap anyone — yours or the CPU's — to scout. Each badge flags a standout skill; the panel shows all eight
          0–99 stats, <span className="cc-help__good">green</span> (strong) to{' '}
          <span className="cc-help__bad">red</span> (weak). The solid ring on a selected player is their <em>move</em>{' '}
          reach this step; the dashed outer ring is the farther <em>sprint</em> burst — more ground, more stamina.
        </p>

        <h3 className="cc-help__h">👀 Reading the floor</h3>
        <p className="cc-help__sec">
          You see <em>your own</em> order lines only. Read the CPU from <strong>motion</strong>: a sprinter trails a{' '}
          <em>streak</em> back along its path — longer and brighter the faster (and more committed) the run, so a hard
          sprint is the most <em>telegraphed</em> and the costliest for them to cut off. A jog leaves no streak. When a
          shooter <em>roots and gathers</em> (a 🎯 windup ring), that's your window to close out. A pass{' '}
          <em>travels</em> as a loose ball — step into its lane to pick it off.
        </p>

        <h3 className="cc-help__h">⚡ Stamina</h3>
        <p className="cc-help__sec">
          Moving burns stamina; a gassed player slows and can't sprint. Pick your moments — you can't crash all five
          every step. It recovers each possession.
        </p>

        <p className="cc-help__text">
          First to <strong>{WIN_TARGET}</strong> (win by 2). Possession alternates after every made basket. Go get a
          bucket.
        </p>

        <button type="button" className="cc-btn cc-btn--primary cc-help__close" onClick={onClose}>
          Got it — let's hoop ▶
        </button>
      </div>
    </div>
  )
}
