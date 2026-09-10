import { useState } from 'react'
import { login, register, setToken } from '../api'

interface LoginPageProps {
  // notify App after authentication so it can reload the user
  onAuthenticated: () => void
}

function LoginPage({ onAuthenticated }: LoginPageProps) {

  // one component, two modes — no need for a second page
  const [mode, setMode] = useState<'login' | 'register'>('login')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    // stop the browser's native submit, which would reload the page
    e.preventDefault()

    setSubmitting(true)
    setError(null)

    try {
      const result =
        mode === 'login'
          ? await login(email, password)
          : await register(email, password, name)

      setToken(result.token)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Chinstein</h1>
      </header>

      <main className="result-layout">
        <section className="card card-result">
          <h2>{mode === 'login' ? 'Log in' : 'Create an account'}</h2>

          <form onSubmit={handleSubmit}>
            {mode === 'register' && (
              <div className="form-field">
                <label htmlFor="display-name">Display name</label>
                <input
                  id="display-name"
                  type="text"
                  placeholder="Display name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={40}
                  disabled={submitting}
                />
                <small>Shown on the leaderboard. Do not use your email.</small>
              </div>
            )}

            <div className="form-field">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-field">
              <input
                type="password"
                placeholder={mode === 'login' ? 'Password' : 'Password (min 8 characters)'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
                disabled={submitting}
              />
            </div>

            <button className="primary-btn wide" type="submit" disabled={submitting}>
              {submitting
                ? 'Working…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Sign up'}
            </button>
          </form>

          {error && <p className="inline-feedback visible error">{error}</p>}

          <p className="result-suggestion">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              className="secondary-btn small"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
              disabled={submitting}
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </section>
      </main>
    </div>
  )
}

export default LoginPage
