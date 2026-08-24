import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTodayCharacter, getQuizOptions } from '../utils/characters'
import type { User } from '../types'
import { getTodayKey, calculateStreak } from '../utils/date'
import { StrokeAnimation } from '../components/StrokeAnimation'
import { getEarnedBadges, getNewBadges } from '../utils/badges'

interface StudyPageProps {
  user: User
  setUser: (user: User) => void
}

function StudyPage({ user, setUser }: StudyPageProps) {
  const character = getTodayCharacter()
  const navigate = useNavigate()

  // pass a function to useState so getQuizOptions only runs on the first render,
  // not on every re-render (e.g. when `selected` changes below)
  const [options] = useState<string[]>(() =>
    getQuizOptions(character, user.learnedCharacterIds)
  )

  // controlled component: the radio's checked state is driven by React state,
  // not by the browser's default form behavior
  const [selected, setSelected] = useState<string | null>(null)

  // whether the user has submitted — locks the options and shows the result
  const [submitted, setSubmitted] = useState(false)

  const isCorrect = selected === character.meaning

  function handleContinue() {
    const alreadyStudiedToday = user.lastStudiedDate === getTodayKey()
    const gainedPoints = isCorrect && !alreadyStudiedToday ? user.todayReward : 0

    const learnedCharacterIds = user.learnedCharacterIds.includes(character.id)
      ? user.learnedCharacterIds
      : [...user.learnedCharacterIds, character.id]

    // build the updated stats first, then derive badges from them
    const updatedUser: User = {
      ...user,
      points: user.points + gainedPoints,
      streak: calculateStreak(user.streak, user.lastStudiedDate),
      learnedCharacterIds,
      lastStudiedDate: getTodayKey(),
      lastSession: null,
    }

    const badges = getEarnedBadges(updatedUser)
    const newBadges = getNewBadges(user.badges, badges)

    setUser({
      ...updatedUser,
      badges,
      lastSession: {
        characterId: character.id,
        isCorrect,
        gainedPoints,
        newBadges,
      },
    })

    navigate('/result')
  }

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

          {options.map(option => (
            <label key={option} className="quiz-option">
              <input
                type="radio"
                name="quiz-answer"
                value={option}
                checked={selected === option}
                disabled={submitted}
                onChange={() => setSelected(option)}
              />
              {option}
            </label>
          ))}

          <button
            className="primary-btn"
            disabled={!selected || submitted}
            onClick={() => setSubmitted(true)}
          >
            Submit
          </button>

          <p
            className={`inline-feedback ${submitted ? 'visible' : ''} ${
              submitted && !isCorrect ? 'error' : ''
            }`}
          >
            {submitted &&
              (isCorrect
                ? 'Correct!'
                : `Not quite — the answer is "${character.meaning}"`)}
          </p>
          {submitted && (
            <button className="primary-btn" onClick={handleContinue}>
              See Results
            </button>
          )}
        </section>
      </main>
    </div>
  )
}

export default StudyPage