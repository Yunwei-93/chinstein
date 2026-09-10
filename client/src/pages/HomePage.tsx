import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchLeaderboard, UnauthorizedError } from '../api'
import { ProfileRow } from '../components/ProfileRow'
import { TodayCard } from '../components/TodayCard'
import { BadgeList } from '../components/BadgeList'
import { Leaderboard } from '../components/Leaderboard'
import type { LeaderboardResponse, UserProfile } from '../types'



interface HomePageProps {
  user: UserProfile
  onLogout: () => void
}

type LeaderboardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: LeaderboardResponse }



function HomePage({ user, onLogout }: HomePageProps) {
  const navigate = useNavigate()
  const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function loadLeaderboard() {
      try {
        const data = await fetchLeaderboard()
        if (!cancelled) {
          setLeaderboardState({ status: 'success', data })
        }
      } catch (err) {
        if (cancelled) return

        if (err instanceof UnauthorizedError) {
          onLogout()
          return
        }

        setLeaderboardState({
          status: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Could not load the leaderboard',
        })
      }
    }

    void loadLeaderboard()

    return () => {
      cancelled = true
    }
  }, [onLogout])


  return (
    <div className="page">
      <header>
        <h1>Chinstein</h1>
        <button
          className="secondary-btn small logout-btn"
          onClick={onLogout}
        >
          Log out
        </button>
      </header>
      <main className="columns">
        <section className="card card-profile">
          <h2>MY PROFILE</h2>
          <ProfileRow label="Name" value={user.name} />
          <ProfileRow label="Level" value={user.level} />
          <ProfileRow label="Points" value={user.points} />
          <ProfileRow
            label="Streak"
            value={`${user.streak} ${user.streak === 1 ? 'day' : 'days'}`}
          />
          <ProfileRow
            label="Characters learned"
            value={user.learnedCharacterIds.length}
          />
          <h3>Badges:</h3>
          <BadgeList badges={user.badges} />
        </section>

        <section className="right-column">
          <section className="card">
            <h2>TOP 10 PLAYERS</h2>
            {leaderboardState.status === 'loading' && (
              <p>Loading leaderboard...</p>
            )}

            {leaderboardState.status === 'error' && (
              <p className="inline-feedback visible error">
                {leaderboardState.message}
              </p>
            )}

            {leaderboardState.status === 'success' && (
              <>
                <Leaderboard
                  entries={leaderboardState.data.entries}
                  currentUserId={
                    leaderboardState.data.currentUser.userId
                  }
                />

                {leaderboardState.data.currentUser.rank === null && (
                  <p className="leaderboard-more">
                    You are not ranked yet. Complete a study session to join.
                  </p>
                )}

                {leaderboardState.data.currentUser.rank !== null &&
                  !leaderboardState.data.entries.some(
                    entry => entry.userId === leaderboardState.data.currentUser.userId,
                  ) && (
                    <p className="leaderboard-more">
                      Your rank: #
                      {leaderboardState.data.currentUser.rank}
                      {' · '}
                      {leaderboardState.data.currentUser.points} points
                    </p>
                  )}
              </>
            )}
          </section>

          <TodayCard
            completed={user.completedToday}
            onStart={() => navigate('/study')}
          />
        </section>
      </main>
    </div>
  )
}


export default HomePage
