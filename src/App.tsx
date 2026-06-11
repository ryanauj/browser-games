import { useEffect, useState } from 'react'
import './App.css'
import { GAMES, findGame } from './games/registry'

/** Read the current game slug from the URL hash (#/court-clash → court-clash). */
function readRoute(): string {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return hash.trim()
}

/** Minimal hash router so deep links and the back button work on GitHub Pages. */
function useHashRoute(): string {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function Landing() {
  return (
    <div className="landing">
      <header className="landing__header">
        <h1 className="landing__title">browser-games</h1>
        <p className="landing__subtitle">A collection of small games you can play in the browser.</p>
      </header>
      <div className="landing__grid">
        {GAMES.map((game) => (
          <a key={game.id} className="game-card" href={`#/${game.id}`}>
            <h2 className="game-card__title">{game.title}</h2>
            <p className="game-card__tagline">{game.tagline}</p>
            <p className="game-card__desc">{game.description}</p>
            <span className="game-card__cta">Play ▶</span>
          </a>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const route = useHashRoute()
  const game = findGame(route)

  if (game) {
    const { Component } = game
    return <Component />
  }
  return <Landing />
}
