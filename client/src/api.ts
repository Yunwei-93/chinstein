import type { UserProfile, TodayCharacter, Session } from './types'

// the API base URL comes from an env var so local and production can differ
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const TOKEN_KEY = 'chinstein-token'

// localStorage: simple and CORS-friendly; the tradeoff is XSS exposure
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// thrown on 401 so callers can tell "log in again" from other failures
export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {

  const token = getToken()
  let res: Response

  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // only send the header when we have a token
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    // fetch only throws on network-level failures, not on 4xx/5xx
    throw new Error('Cannot reach the server. Is the API running?')
  }

  if (res.status === 401) {
    // stale token: drop it so the app falls back to the login screen
    clearToken()
    const body = await res.json().catch(() => null)
    throw new UnauthorizedError(body?.error ?? 'Please log in again')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export interface AuthResponse {
  token: string
  user: { id: number; name: string }
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function register(
  email: string,
  password: string,
  name?: string
): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })
}

// none of these take a userId any more; the server reads it from the token

export function fetchMe(): Promise<UserProfile> {
  return request<UserProfile>('/api/me')
}

export function fetchTodayCharacter(): Promise<TodayCharacter> {
  return request<TodayCharacter>('/api/characters/today')
}


export function submitSession(
  characterId: number,
  answer: string
): Promise<Session> {
  return request<Session>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ characterId, answer }),
  })
}