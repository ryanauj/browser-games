interface Props {
  lines: string[]
}

/** Rolling play-by-play feed (newest first). */
export function GameLog({ lines }: Props) {
  return (
    <div className="cc-log">
      <div className="cc-log__title">PLAY-BY-PLAY</div>
      <ul className="cc-log__list">
        {lines.slice(0, 12).map((line, i) => (
          <li key={`${i}-${line}`} className={i === 0 ? 'cc-log__line cc-log__line--latest' : 'cc-log__line'}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}
