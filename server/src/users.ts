import { pool } from './db.js'
import { getEarnedBadges } from './badges.js'
import type { Level, UserProfile } from './types.js'

export const TODAY_REWARD = 20

// the query returns snake_case; we map it to camelCase below
interface ProfileRow {
  id: number
  name: string
  points: number
  streak: number
  last_studied_date: string | null
  learned_character_ids: number[]
  ls_character_id: number | null
  ls_character: string | null
  ls_meaning: string | null
  ls_is_correct: boolean | null
  ls_points: number | null
}

const PROFILE_SQL = `
WITH days AS (
  SELECT DISTINCT studied_on FROM study_sessions WHERE user_id = $1
),

-- consecutive dates minus their row number collapse to the same value
islands AS (
  SELECT studied_on,
         studied_on - (ROW_NUMBER() OVER (ORDER BY studied_on))::int AS grp
    FROM days
),
latest AS (
  SELECT grp, MAX(studied_on) AS last_day FROM islands GROUP BY grp
   ORDER BY last_day DESC LIMIT 1
),
streak AS (

  -- the latest island only counts if it reaches today or yesterday
  SELECT COALESCE((
    SELECT CASE WHEN l.last_day >= CURRENT_DATE - 1
                THEN (SELECT COUNT(*) FROM islands WHERE grp = l.grp)
                ELSE 0 END
      FROM latest l
  ), 0)::int AS value
),
totals AS (
  SELECT COALESCE(SUM(points), 0)::int AS points,
         MAX(studied_on)::text         AS last_studied_date,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT character_id), NULL) AS learned_character_ids
    FROM study_sessions WHERE user_id = $1
),
last_session AS (
  SELECT s.character_id, s.is_correct, s.points,
         c.character, c.meaning
    FROM study_sessions s
    JOIN characters c ON c.id = s.character_id
   WHERE s.user_id = $1
   ORDER BY s.studied_on DESC, s.id DESC LIMIT 1
)
SELECT u.id, u.name,
       t.points,
       s.value AS streak,
       t.last_studied_date,
       COALESCE(t.learned_character_ids, '{}') AS learned_character_ids,
       ls.character_id AS ls_character_id,
       ls.character    AS ls_character,
       ls.meaning      AS ls_meaning,
       ls.is_correct   AS ls_is_correct,
       ls.points       AS ls_points
  FROM users u
  CROSS JOIN totals t
  CROSS JOIN streak s
  LEFT JOIN last_session ls ON true
 WHERE u.id = $1`

function levelFor(points: number): Level {
  if (points >= 1000) return 'Advanced'
  if (points >= 600) return 'Intermediate'
  return 'Beginner'
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const { rows } = await pool.query<ProfileRow>(PROFILE_SQL, [userId])
  const row = rows[0]
  if (!row) return null

  const badges = getEarnedBadges({
    points: row.points,
    streak: row.streak,
    learnedCharacterIds: row.learned_character_ids,
  })

  return {
    id: row.id,
    name: row.name,
    level: levelFor(row.points),
    points: row.points,
    streak: row.streak,
    badges,
    learnedCharacterIds: row.learned_character_ids,
    lastStudiedDate: row.last_studied_date,
    todayReward: TODAY_REWARD,
    lastSession:
      row.ls_character_id === null
        ? null
        : {
            characterId: row.ls_character_id,
            character: row.ls_character ?? '',
            meaning: row.ls_meaning ?? '',
            isCorrect: row.ls_is_correct ?? false,
            gainedPoints: row.ls_points ?? 0,
            newBadges: [],
          },
  }
}