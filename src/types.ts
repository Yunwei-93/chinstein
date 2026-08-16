export interface Session {
  character: string
  isCorrect: boolean
  gainedPoints: number
}

export interface User {
  name: string
  level: "Beginner" | "Intermediate" | "Advanced"
  points: number
  streak: number
  badges: string[]
  todayCharacter: string
  todayReward: number
  lastSession: Session | null
  justCompletedSession: boolean
}

export interface LeaderboardEntry {
  name: string
  points: number
}