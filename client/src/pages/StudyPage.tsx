import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { StrokeAnimation } from '../components/StrokeAnimation'
import { fetchTodayCharacter, submitSession} from '../api'
import type { UserProfile, TodayCharacter } from '../types'

interface StudyPageProps {
  user: UserProfile
  onSessionComplete: () => void
}

// same pattern as App.tsx, this one tracks the today-character request
type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function StudyPage({ user, onSessionComplete }: StudyPageProps) {
  const navigate = useNavigate()

  const [charState, setCharState] = useState<Async<TodayCharacter>>({ status: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)

  // submission state: null = not submitted, string = why it failed
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await fetchTodayCharacter()
 
        // don't setState after unmount — avoids races and leaks
        if (!cancelled) setCharState({ status: 'success', data })
      } catch (err) {
        if (!cancelled) {
          setCharState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load',
          })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit() {
    if (!selected || charState.status !== 'success') return

    setSubmitting(true)
    setSubmitError(null)

    try {

      // the server does the grading; we only submit what the user picked
      await submitSession(charState.data.id, selected)

      // tell App to refetch — points, streak and badges have all changed
      onSessionComplete()

      navigate('/result')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  if (charState.status === 'loading') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="subtitle">Loading today's character…</p>
      </div>
    )
  }

  if (charState.status === 'error') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="inline-feedback visible error">{charState.message}</p>
        <button className="secondary-btn" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    )
  }

  const character = charState.data

  return (
    <div className="page">
      <header>
        <h1>Chinstein</h1>
      </header>

      <main className="study-layout">
        <section className="card card-story">
          <h2>Step 1 – Read the story</h2>
          <article className="story-box">
            <h3 className="story-box-title">
              <span className="char-highlight">{character.character}</span>
            </h3>
            <p>{character.pinyin}</p>
            <p>{character.story}</p>
          </article>

          <StrokeAnimation character={character.character} />
        </section>

        <section className="card card-quiz">
          <h2>Step 2 – Answer the quiz</h2>
          <p className="quiz-question">
            What does <span className="char-highlight">{character.character}</span> mean?
          </p>

          {character.options.map(option => (
            <label key={option} className="quiz-option">
              <input
                type="radio"
                name="quiz-answer"
                value={option}
                checked={selected === option}
                disabled={submitting}
                onChange={() => setSelected(option)}
              />
              {option}
            </label>
          ))}

          <button
            className="primary-btn"
            disabled={!selected || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>

          {submitError && (
            <p className="inline-feedback visible error">{submitError}</p>
          )}

          <p className="subtitle secondary">
            {user.name} · {user.points} points
          </p>
        </section>
      </main>
    </div>
  )
}

export default StudyPage