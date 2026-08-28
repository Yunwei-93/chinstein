import { pool } from './db.js'
import type { Character, TodayCharacter } from './types.js'
import { generateStory } from './claude.js'

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

// atomic claim; the timeout clause reclaims rows left behind by a crash
const CLAIM_SQL = `
  UPDATE characters
     SET story_status = 'generating', story_started_at = NOW()
   WHERE id = $1
     AND (story_status = 'pending'
          OR (story_status = 'generating'
              AND story_started_at < NOW() - INTERVAL '2 minutes'))
  RETURNING id`

const SAVE_SQL = `
  UPDATE characters
     SET story = $2, story_status = 'ready', story_source = 'claude'
   WHERE id = $1`

// release the claim so the next request can retry immediately
const RELEASE_SQL = `
  UPDATE characters
     SET story_status = 'pending', story_started_at = NULL
   WHERE id = $1`

// 缓存未命中时生成字源。
// 返回 null = 这次拿不到（别人在生成 / 调用失败），调用方降级而不是报错。
// null means "not this time" — the caller degrades instead of failing
async function ensureStory(c: Character): Promise<string | null> {
  if (c.story) return c.story              

  const claim = await pool.query(CLAIM_SQL, [c.id])
  if (!claim.rowCount) {
    // the claim can fail because someone is generating OR just finished; re-read before degrading
    const { rows } = await pool.query<{ story: string | null }>(
      'SELECT story FROM characters WHERE id = $1', [c.id]
  )
  return rows[0]?.story ?? null
  }   

  const story = await generateStory(c.character, c.pinyin, c.meaning)

  if (!story) {
    await pool.query(RELEASE_SQL, [c.id])  
    return null
  }

  await pool.query(SAVE_SQL, [c.id, story])
  return story
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