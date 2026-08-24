import type { Character } from "../types"
import { characters } from "../data/characters"

export function getTodayCharacter(): Character {

  const msPerDay = 1000 * 60 * 60 * 24

  const daysSinceEpoch = Math.floor(Date.now() / msPerDay)

  const pos = daysSinceEpoch % characters.length

  return characters[pos]
}

export function getQuizOptions(correct: Character, learnedIds: number[]): string[] {

  const learned = characters.filter(
    c => learnedIds.includes(c.id) && c.id !== correct.id
  )

  const pool = learned.length >= 2
    ? learned
    : characters.filter(c => c.id !== correct.id)

  const distractors = shuffle(pool).slice(0, 2).map(c => c.meaning)

  return shuffle([correct.meaning, ...distractors])
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array]          // copy the array, don't mutate the original

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))   // pick a random index in [0, i]
    ;[result[i], result[j]] = [result[j], result[i]] // swap the two positions
  }

  return result
}

export function getCharacterById(id: number): Character | undefined {
  return characters.find(c => c.id === id)
}