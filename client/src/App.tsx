import { useState, useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import HomePage from './pages/HomePage'
import StudyPage from './pages/StudyPage'
import ResultPage from './pages/ResultPage'
import LoginPage from './pages/LoginPage'
import { fetchMe, clearToken, UnauthorizedError } from './api'
import type { UserProfile } from './types'


// four explicit states — mutually exclusive by construction
type Async<T> =
  | { status: 'loading' }
  // not-logged-in is a normal state, not a failure
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function App() {
  const [userState, setUserState] = useState<Async<UserProfile>>({ status: 'loading' })


  // useCallback keeps the same function reference across renders,
  // otherwise the effect below would re-run forever
  const loadUser = useCallback(async () => {
    try {
      const data = await fetchMe()
      setUserState({ status: 'success', data })
    } catch (err) {
      // a 401 means "log in"; anything else is an actual failure
      if (err instanceof UnauthorizedError) {
        setUserState({ status: 'unauthenticated' })
        return
      }

      setUserState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong',
      })
    }
  }, [])

  const reload = useCallback(() => {
    setUserState({ status: 'loading' })
    loadUser()
  }, [loadUser])

  useEffect(() => {
    // all setState calls happen after the await — no synchronous cascade here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUser()
  }, [loadUser])

  // JWTs are stateless: the server cannot revoke one, the client just drops it

  const handleLogout = useCallback(() => {
    clearToken()
    setUserState({ status: 'unauthenticated' })
  }, [])

  if (userState.status === 'loading') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="subtitle">Loading…</p>
      </div>
    )
  }

  if (userState.status === 'unauthenticated') {
    return <LoginPage onAuthenticated={reload} />
  }

  if (userState.status === 'error') {
    return (
      <div className="page">
        <header><h1>Chinstein</h1></header>
        <p className="inline-feedback visible error">{userState.message}</p>
        <button className="primary-btn" onClick={reload}>Retry</button>
      </div>
    )
  }

  // TS has narrowed the union: data is guaranteed to exist here
  const user = userState.data

  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} onLogout={handleLogout} />} />
      <Route
        path="/study"
        element={<StudyPage user={user} onSessionComplete={reload} />}
      />
      <Route path="/result" element={<ResultPage user={user} />} />
    </Routes>
  )
}

export default App