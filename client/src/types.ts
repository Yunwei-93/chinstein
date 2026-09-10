export type Level = "Beginner" | "Intermediate" | "Advanced"

// the outcome of one study session
export interface Session {
  characterId: number
  character: string
  meaning: string
  isCorrect: boolean
  gainedPoints: number
  newBadges: string[]
}

// what GET /api/users/:id returns
export interface UserProfile {
  id: number
  name: string
  level: Level
  points: number
  streak: number
  badges: string[]
  learnedCharacterIds: number[]
  lastStudiedDate: string | null
  completedToday: boolean
  todayReward: number
  lastSession: Session | null
}

// what GET /api/characters/today returns — note: no meaning
export interface TodayCharacter {
  id: number
  character: string
  pinyin: string
  story: string | null
  level: Level
  options: string[]
}

export interface LeaderboardEntry {
  userId: number
  name: string
  points: number
  rank: number
}

export interface LeaderboardCurrentUser {
  userId: number
  name: string
  points: number
  rank: number | null
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  currentUser: LeaderboardCurrentUser
}
