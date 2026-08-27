export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface Character {
  id: number
  character: string
  pinyin: string
  meaning: string
  story: string
  level: Level
}

// what the client receives: meaning stripped, shuffled options added
export type TodayCharacter = Omit<Character, 'meaning'> & {
  options: string[]
}

export interface Session {
  characterId: number
  character: string
  meaning: string
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
  completedToday: boolean
  todayReward: number
  lastSession: Session | null
}