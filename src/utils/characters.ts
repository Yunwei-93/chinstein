import type { Character } from "../types"
import { characters } from "../data/characters"

export function getTodayCharacter(): Character {

  const msPerDay = 1000 * 60 * 60 * 24

  const daysSinceEpoch = Math.floor(Date.now() / msPerDay)

  const pos = daysSinceEpoch % characters.length

  return characters[pos]
}