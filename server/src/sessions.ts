import { pool } from './db.js'
import { getUserProfile, TODAY_REWARD } from './users.js'
import { getNewBadges } from './badges.js'
import type { Session } from './types.js'

// custom error types so the route layer can map each to a different HTTP code
export class AlreadyStudiedTodayError extends Error {}
export class CharacterNotFoundError extends Error {}

export async function createSession(
  userId: number,
  characterId: number,
  answer: string
): Promise<Session> {

  // snapshot the badges before, so we can diff afterwards
  const before = await getUserProfile(userId)
  if (!before) throw new Error('User not found')

  // the correct answer comes from the DB; we never trust the client's verdict
  const { rows } = await pool.query<{ character: string; meaning: string }>(
    'SELECT character, meaning FROM characters WHERE id = $1',
    [characterId]
  )
  const character = rows[0]
  if (!character) throw new CharacterNotFoundError()

  const isCorrect = answer === character.meaning
  const gainedPoints = isCorrect ? TODAY_REWARD : 0

  try {

    // the server decides the date so nobody can backfill fake streaks
    await pool.query(
      `INSERT INTO study_sessions (user_id, character_id, is_correct, points, studied_on)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)`,
      [userId, characterId, isCorrect, gainedPoints]
    )
  } catch (err) {

    // 23505 is Postgres's unique_violation code
    if ((err as { code?: string }).code === '23505') {
      throw new AlreadyStudiedTodayError()
    }
    throw err
  }

  const after = await getUserProfile(userId)
  const newBadges = getNewBadges(before.badges, after?.badges ?? [])

  return {
    characterId,
    character: character.character,
    meaning: character.meaning,
    isCorrect,
    gainedPoints,
    newBadges,
  }
}