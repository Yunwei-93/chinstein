import type { UserProfile, TodayCharacter, Session } from './types'

// the API base URL comes from an env var so local and production can differ
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// hard-coded until auth exists
export const CURRENT_USER_ID = 1

// the server returns { error: "..." } on failure; surface that message
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    // fetch only throws on network-level failures, not on 4xx/5xx
    throw new Error('Cannot reach the server. Is the API running?')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export function fetchUser(userId: number): Promise<UserProfile> {
  return request<UserProfile>(`/api/users/${userId}`)
}

export function fetchTodayCharacter(userId: number): Promise<TodayCharacter> {
  return request<TodayCharacter>(`/api/characters/today?userId=${userId}`)
}

export function submitSession(
  userId: number,
  characterId: number,
  answer: string
): Promise<Session> {
  return request<Session>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ userId, characterId, answer }),
  })
}

