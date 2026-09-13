import { pool } from './db.js'
import type { Character, TodayCharacter } from './types.js'
import { generateStory, isGenerationEnabled } from './claude.js'

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

const MAX_STORY_ATTEMPTS = 3

const FAIL_STALE_EXHAUSTED_SQL = `
  UPDATE characters
     SET story_status = 'failed',
         story_started_at = NULL
   WHERE id = $1
     AND story_status = 'generating'
     AND story_attempts >= $2
     AND (
       story_started_at IS NULL
       OR story_started_at < NOW() - INTERVAL '2 minutes'
     )`

// Claiming permission to call Anthropic consumes one attempt atomically.
const CLAIM_SQL = `
  UPDATE characters
     SET story_status = 'generating',
         story_started_at = NOW(),
         story_attempts = story_attempts + 1
   WHERE id = $1
     AND story_attempts < $2
     AND (
       story_status = 'pending'
       OR (
         story_status = 'generating'
         AND story_started_at < NOW() - INTERVAL '2 minutes'
       )
     )
  RETURNING id`

const SAVE_SQL = `
  UPDATE characters
     SET story = $2,
         story_status = 'ready',
         story_source = 'claude',
         story_started_at = NULL
   WHERE id = $1`

const RELEASE_SQL = `
  UPDATE characters
     SET story_status = CASE
           WHEN story_attempts >= $2 THEN 'failed'
           ELSE 'pending'
         END,
         story_started_at = NULL
   WHERE id = $1`

// null means "not this time" — the caller degrades instead of failing
async function ensureStory(c: Character): Promise<string | null> {
  if (c.story) return c.story
  if (!isGenerationEnabled()) return null
  await pool.query(FAIL_STALE_EXHAUSTED_SQL, [
    c.id,
    MAX_STORY_ATTEMPTS,
  ])

  const claim = await pool.query(CLAIM_SQL, [
    c.id,
    MAX_STORY_ATTEMPTS,
  ])
  if (!claim.rowCount) {
    // the claim can fail because someone is generating OR just finished; re-read before degrading
    const { rows } = await pool.query<{ story: string | null }>(
      'SELECT story FROM characters WHERE id = $1', [c.id]
    )
    return rows[0]?.story ?? null
  }

  let saved = false

  try {
    const story = await generateStory(c.character, c.pinyin, c.meaning)

    if (!story) return null

    await pool.query(SAVE_SQL, [c.id, story])
    saved = true
    return story
  } finally {
    if (!saved) {
      await pool.query(RELEASE_SQL, [
        c.id,
        MAX_STORY_ATTEMPTS,
      ])
    }
  }
}


export async function getTodayCharacterForClient(
  learnedIds: number[]
): Promise<TodayCharacter | null> {
  const character = await getTodayCharacter()
  if (!character) return null

  // on a miss we generate; on failure story stays null and the page degrades
  const story = await ensureStory(character)

  // only draw distractors from learned characters once there are at least 2
  const learnedPool = learnedIds.length >= 2 ? learnedIds : null

  const { rows } = await pool.query<{ meaning: string }>(OPTIONS_SQL, [
    character.id,
    learnedPool,
  ])

  // strip meaning so the answer never reaches the browser
  const { meaning: _meaning, ...safe } = character

  return { ...safe, story, options: rows.map(r => r.meaning) }
}