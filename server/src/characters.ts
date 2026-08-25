import { pool } from './db.js'
import type { Character, TodayCharacter } from './types.js'

// pick today's character by date so everyone sees the same one on a given day
export async function getTodayCharacter(): Promise<Character | null> {
  const { rows } = await pool.query<Character>(
    `SELECT id, character, pinyin, meaning, story, level
       FROM characters
      ORDER BY id
      OFFSET (
        SELECT (EXTRACT(EPOCH FROM CURRENT_DATE)::bigint / 86400) % GREATEST(COUNT(*), 1)
          FROM characters
      )
      LIMIT 1`
  )
  return rows[0] ?? null
}


// one query: correct answer + 2 distractors, shuffled together
const OPTIONS_SQL = `
  SELECT meaning FROM (
    SELECT meaning FROM characters WHERE id = $1
    UNION ALL
    (SELECT meaning FROM characters
      WHERE id <> $1
        AND ($2::int[] IS NULL OR id = ANY($2::int[]))
      ORDER BY RANDOM() LIMIT 2)
  ) opts
  ORDER BY RANDOM()`

export async function getTodayCharacterForClient(
  learnedIds: number[]
): Promise<TodayCharacter | null> {
  const character = await getTodayCharacter()
  if (!character) return null


  // only draw distractors from learned characters once there are at least 2
  const learnedPool = learnedIds.length >= 2 ? learnedIds : null

  const { rows } = await pool.query<{ meaning: string }>(OPTIONS_SQL, [
    character.id,
    learnedPool,
  ])


  // strip meaning so the answer never reaches the browser
  const { meaning: _meaning, ...safe } = character

  return { ...safe, options: rows.map(r => r.meaning) }
}