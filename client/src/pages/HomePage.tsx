import { ProfileRow } from '../components/ProfileRow'
import type { UserProfile, LeaderboardEntry } from '../types'
import { TodayCard } from '../components/TodayCard'
import { BadgeList } from '../components/BadgeList'
import { Leaderboard } from '../components/Leaderboard'
import { useNavigate } from 'react-router-dom'
import { getTodayKey } from '../utils/date'

interface HomePageProps {
  user: UserProfile

}

function HomePage({ user }: HomePageProps) {


  const navigate = useNavigate()

  // derive "done today" from lastStudiedDate instead of storing a separate flag
  const completedToday = user.lastStudiedDate === getTodayKey()


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
          <ProfileRow label="Streak" value={`${user.streak} ${user.streak === 1 ? 'day' : 'days'}`} />
          <ProfileRow label="Characters learned" value={user.learnedCharacterIds.length} />
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
            completed={completedToday} 
            onStart={() => navigate('/study')} 
          />

         </section>

      </main>


    </div>
  )
}


export default HomePage
