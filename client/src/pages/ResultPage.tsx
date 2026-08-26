import { useNavigate } from 'react-router-dom'
import { BadgeList } from '../components/BadgeList'
import type { UserProfile } from '../types'

interface ResultPageProps {
  user: UserProfile
}

function ResultPage({ user }: ResultPageProps) {
  const navigate = useNavigate()
  const session = user.lastSession

  // guard for hitting /result directly without a session
  if (!session) {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <main className="result-layout">
          <section className="card card-result">
            <h2>No session yet</h2>
            <p className="result-suggestion">Go study today's character first.</p>
            <button className="primary-btn wide" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <header>
        <h1>Chinstein</h1>
      </header>

      <main className="result-layout">
        <section className="card card-result">
          <h2>{session.isCorrect ? 'Nice work!' : 'Good try!'}</h2>

          {/* the character and its meaning now come from the API */}
          <p className="result-main-line">
            You studied <span className="char-highlight">{session.character}</span>{' '}
            ({session.meaning}) today.
          </p>

          <p className="result-points">+{session.gainedPoints} points</p>
          <p className="result-secondary">Total points: {user.points}</p>
          <p className="result-secondary">
            Streak: {user.streak} {user.streak === 1 ? 'day' : 'days'}
          </p>

          {session.newBadges.length > 0 && (
            <p className="result-badge">
              New badge{session.newBadges.length > 1 ? 's' : ''} unlocked:{' '}
              {session.newBadges.join(', ')}
            </p>
          )}

          <h3>Badges</h3>
          <BadgeList badges={user.badges} />

          <p className="result-suggestion">Come back tomorrow for a new character.</p>

          <div className="button-column">
            <button className="primary-btn wide" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

export default ResultPage