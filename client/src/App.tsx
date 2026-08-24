
import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import HomePage from './pages/HomePage'
import StudyPage from './pages/StudyPage'
import ResultPage from './pages/ResultPage'
import type { User} from './types'

const STORAGE_KEY = 'chinstein-user'
const defaultUser: User = {
  name: "Yunwei Li",
  level: "Beginner",
  points: 600,
  streak: 0,
  badges: ["600 Points Club"],
  learnedCharacterIds: [],
  lastStudiedDate: null,
  todayReward: 20,
  lastSession: null,

}



function App() {

  // lazy init: read localStorage only on the first render
  const [user, setUser] = useState<User>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)

    if (!saved) return defaultUser

    try {
      return JSON.parse(saved) as User
    } catch {

      // corrupted data (hand-edited, or an old incompatible format) → fall back
      return defaultUser
    }
  })

  // persist user to localStorage whenever it changes

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }, [user])



  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} />} />
      <Route path="/study" element={<StudyPage user={user} setUser={setUser} />} />
      <Route path="/result" element={<ResultPage user={user} />} />
    </Routes>
  )
}

export default App