
import './App.css'
import { useState } from 'react'
import { ProfileRow } from './components/ProfileRow'
import type { User, LeaderboardEntry } from './types'
import { TodayCard } from './components/TodayCard'
import { BadgeList } from './components/BadgeList'
import { Leaderboard } from './components/Leaderboard'


function App() {

  const [user, setUser] = useState<User>({
    name: "Yunwei Li",
    level: "Beginner",
    points: 600,
    streak: 0,
    badges: ["600 Points Club"],
    todayCharacter: "龙",
    todayReward: 0,
    lastSession: null,
    justCompletedSession: true
  })

  const others: LeaderboardEntry[] = [
    { name: "Junwei Ji", points: 750 },
    { name: "Tian Zhou", points: 400 }
  ]

  return (
    <div className="page">
      <header>
        <h1>Chinstein</h1>
      </header>
      <main className="columns">
         <section className="card card-profile">
          <h2>MY PROFILE</h2>
          <ProfileRow label="Name" value={user.name} />
          <ProfileRow label="Level" value={user.level} />
          <ProfileRow label="Points" value={user.points} />
          <ProfileRow label="Streak" value={`${user.streak} days`} />
          <h3>Badges:</h3>
          <BadgeList badges={user.badges} />
         </section>

         <section className="right-column">
          <section className="card">
            <h2>LEADERBOARD</h2>
            <Leaderboard 
              entries={[{ name: user.name, points: user.points }, ...others]}
              currentUserName={user.name}
            />
          </section>

          <TodayCard 
            character={user.todayCharacter} 
            onStart={() => console.log("start clicked")} 
          />

         </section>

      </main>

      <button onClick={() => setUser({ ...user, points: user.points + 20 })}>
        Answer correctly (+20)
      </button>

    </div>
  )
}


export default App
