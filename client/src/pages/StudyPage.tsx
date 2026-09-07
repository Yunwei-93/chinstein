import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { StrokeAnimation } from '../components/StrokeAnimation'
import {
  ApiError,
  UnauthorizedError,
  fetchTodayCharacter,
  submitSession,
} from '../api'
import type { UserProfile, TodayCharacter } from '../types'

interface StudyPageProps {
  user: UserProfile
  onUserRefresh: () => void
}

// same pattern as App.tsx, this one tracks the today-character request
type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

type SubmitFailure = {
  message: string
  recovery?: 'view-result' | 'reload-lesson'
}

function StudyPage({ user, onUserRefresh }: StudyPageProps) {
  const navigate = useNavigate()

  const [charState, setCharState] = useState<Async<TodayCharacter>>({ status: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)

  // null means no failure; otherwise stores the message and recovery action
  const [submitting, setSubmitting] = useState(false)
  const [submitFailure, setSubmitFailure] = useState<SubmitFailure | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await fetchTodayCharacter()

        // don't setState after unmount — avoids races and leaks
        if (!cancelled) setCharState({ status: 'success', data })
      } catch (err) {

        if (cancelled) return
        if (err instanceof UnauthorizedError) {
          onUserRefresh()
          return
        }

        setCharState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load',
        })

      }
    }

    load()
    return () => { cancelled = true }
  }, [onUserRefresh])

  async function handleSubmit() {
    if (!selected || charState.status !== 'success') return

    setSubmitting(true)
    setSubmitFailure(null)

    try {

      // the server does the grading; we only submit what the user picked
      await submitSession(charState.data.id, selected)

      // tell App to refetch — points, streak and badges have all changed
      onUserRefresh()

      navigate('/result')
    } catch (err) {

      if (err instanceof UnauthorizedError) {
        onUserRefresh()
        return
      }

      let failure: SubmitFailure = {
        message: 'Submission failed',
      }

      if (err instanceof ApiError) {
        switch (err.code) {
          case 'ALREADY_STUDIED_TODAY':
            failure = {
              message: "You've already completed today's lesson.",
              recovery: 'view-result',
            }
            break
          case 'NOT_TODAYS_CHARACTER':
            failure = {
              message: "Today's character has changed. Reload the lesson to continue.",
              recovery: 'reload-lesson',
            }
            break
          case 'CHARACTER_NOT_FOUND':
            failure = {
              message: 'This character is no longer available. Reload the lesson.',
              recovery: 'reload-lesson',
            }
            break
          default:
            failure = { message: err.message }
        }
      } else if (err instanceof Error) {
        failure = { message: err.message }
      }

      setSubmitFailure(failure)
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
  const requiresRecovery = submitFailure?.recovery !== undefined

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
            {character.story ? (
              <p>{character.story}</p>
            ) : (
              // the story may not exist yet; degrade with a note instead of a blank gap
              <p className="story-pending">
                We're still writing the story for this character. The stroke order
                and quiz below still work — check back in a moment.
              </p>
            )}
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
                disabled={submitting || requiresRecovery}
                onChange={() => setSelected(option)}
              />
              {option}
            </label>
          ))}

          <button
            className="primary-btn"
            disabled={!selected || submitting || requiresRecovery}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>

          {submitFailure && (
            <>
              <p className="inline-feedback visible error">
                {submitFailure.message}
              </p>

              {submitFailure.recovery === 'view-result' && (
                <button
                  className="secondary-btn"
                  onClick={() => {
                    onUserRefresh()
                    navigate('/result', { replace: true })
                  }}
                >
                  View today's result
                </button>
              )}

              {submitFailure.recovery === 'reload-lesson' && (
                <button
                  className="secondary-btn"
                  onClick={() => navigate(0)}
                >
                  Reload lesson
                </button>
              )}
            </>
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
