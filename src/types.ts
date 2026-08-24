export interface Session {
  characterId: number
  isCorrect: boolean
  gainedPoints: number
  newBadges: string[]
}

export interface User {
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

export interface LeaderboardEntry {
  name: string
  points: number
}

export type Level = "Beginner" | "Intermediate" | "Advanced"

export interface Character {
  id: number
  character: string     
  pinyin: string       
  meaning: string      
  story: string         
  level: Level
}

