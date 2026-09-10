import { pool } from './db.js'

export interface LeaderboardEntry {
    userId: number
    name: string
    points: number
    rank: number
}

export interface LeaderboardCurrentUser {
    userId: number
    name: string
    points: number
    rank: number | null
}

export interface Leaderboard {
    entries: LeaderboardEntry[]
    currentUser: LeaderboardCurrentUser
}

interface LeaderboardRow {
    entries: LeaderboardEntry[]
    current_user: LeaderboardCurrentUser | null
}

const LEADERBOARD_SQL = `
WITH studied AS (
  SELECT
    user_id,
    SUM(points)::int AS points
  FROM study_sessions
  GROUP BY user_id
),
ranked AS (
  SELECT
    u.id AS user_id,
    CASE
      WHEN u.leaderboard_name_public THEN u.name
      ELSE 'player_' || u.id::text
    END AS name,
    studied.points,
    (RANK() OVER (ORDER BY studied.points DESC))::int AS rank,
    (
      ROW_NUMBER() OVER (
        ORDER BY studied.points DESC, u.id
      )
    )::int AS position
  FROM studied
  JOIN users u ON u.id = studied.user_id
),
me AS (
  SELECT
    u.id AS user_id,
    CASE
      WHEN u.leaderboard_name_public THEN u.name
      ELSE 'player_' || u.id::text
    END AS name,
    COALESCE(ranked.points, 0)::int AS points,
    ranked.rank
  FROM users u
  LEFT JOIN ranked ON ranked.user_id = u.id
  WHERE u.id = $1
)
SELECT
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'userId', ranked.user_id,
          'name', ranked.name,
          'points', ranked.points,
          'rank', ranked.rank
        )
        ORDER BY ranked.position
      )
      FROM ranked
      WHERE ranked.position <= 10
    ),
    '[]'::json
  ) AS entries,
  (
    SELECT json_build_object(
      'userId', me.user_id,
      'name', me.name,
      'points', me.points,
      'rank', me.rank
    )
    FROM me
  ) AS current_user
`

export async function getLeaderboard(
    userId: number,
): Promise<Leaderboard | null> {
    const result = await pool.query<LeaderboardRow>(LEADERBOARD_SQL, [userId])
    const row = result.rows[0]

    if (!row?.current_user) {
        return null
    }

    return {
        entries: row.entries,
        currentUser: row.current_user,
    }
}