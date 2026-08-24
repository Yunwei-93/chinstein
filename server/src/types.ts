export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface Character {
  id: number
  character: string
  pinyin: string
  meaning: string
  story: string
  level: Level
}