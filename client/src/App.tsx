import { useState, useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import HomePage from './pages/HomePage'
import StudyPage from './pages/StudyPage'
import ResultPage from './pages/ResultPage'
import { fetchUser, CURRENT_USER_ID } from './api'
import type { UserProfile } from './types'


// three explicit states — mutually exclusive by construction
type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function App() {
  const [userState, setUserState] = useState<Async<UserProfile>>({ status: 'loading' })


  // useCallback keeps the same function reference across renders,
  // otherwise the effect below would re-run forever
  const loadUser = useCallback(async () => {
    setUserState({ status: 'loading' })
    try {
      const data = await fetchUser(CURRENT_USER_ID)
      setUserState({ status: 'success', data })
    } catch (err) {
      setUserState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong',
      })
    }
  }, [])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  if (userState.status === 'loading') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="subtitle">Loading…</p>
      </div>
    )
  }

  if (userState.status === 'error') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="inline-feedback visible error">{userState.message}</p>
        <button className="primary-btn" onClick={loadUser}>Retry</button>
      </div>
    )
  }

  // TS has narrowed the union: data is guaranteed to exist here
  const user = userState.data

  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} />} />
      <Route
        path="/study"
        element={<StudyPage user={user} onSessionComplete={loadUser} />}
      />
      <Route path="/result" element={<ResultPage user={user} />} />
    </Routes>
  )
}

export default App