export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface Character {
  id: number
  character: string
  pinyin: string
  meaning: string
  story: string
  level: Level
}

export interface Session {
  characterId: number
  isCorrect: boolean
  gainedPoints: number
  newBadges: string[]
}

// the shape returned to the client, mirroring the frontend's User
export interface UserProfile {
  id: number
  name: string
  level: Level
  points: number
  streak: number
  badges: string[]
  learnedCharacterIds: number[]
  lastStudiedDate: string | null
  todayReward: number
  lastSession: Session | null
}