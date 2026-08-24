import { pool } from './db.js'
import type { Character } from './types.js'

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