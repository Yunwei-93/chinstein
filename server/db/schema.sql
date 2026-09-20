

--  idempotent: safe to run more than once
CREATE TABLE IF NOT EXISTS characters (
  id         SERIAL PRIMARY KEY,
  character  TEXT NOT NULL UNIQUE,
  pinyin     TEXT NOT NULL,
  meaning    TEXT NOT NULL,
  story      TEXT NOT NULL,
  level      TEXT NOT NULL
);

-- story is now optional — new characters are seeded without one and filled in on demand
ALTER TABLE characters 
ALTER COLUMN story 
DROP NOT NULL;

ALTER TABLE characters 
ADD COLUMN 
IF NOT EXISTS story_status TEXT NOT NULL DEFAULT 'pending';

-- lets a stuck 'generating' row be reclaimed after a timeout
ALTER TABLE characters 
ADD COLUMN 
IF NOT EXISTS story_started_at TIMESTAMPTZ;

-- count granted generation attempts, including attempts interrupted by a task exit
ALTER TABLE characters
ADD COLUMN IF NOT EXISTS story_attempts INTEGER NOT NULL DEFAULT 0;

-- track provenance: hand-written vs model-generated
ALTER TABLE characters 
ADD COLUMN 
IF NOT EXISTS story_source TEXT;

ALTER TABLE characters
DROP CONSTRAINT IF EXISTS characters_story_status_check;

ALTER TABLE characters
ADD CONSTRAINT characters_story_status_check
CHECK (story_status IN ('pending', 'generating', 'ready', 'failed'));

UPDATE characters
   SET story_status = 'ready',
       story_source = COALESCE(story_source, 'seed')
 WHERE story IS NOT NULL AND story_status <> 'ready';

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  leaderboard_name_public BOOLEAN NOT NULL DEFAULT FALSE,
  email      TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS won't touch an existing table, so alter explicitly
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS leaderboard_name_public BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.name IS
  'Display names are intentionally non-unique; use users.id for identity.';

COMMENT ON COLUMN users.leaderboard_name_public IS
  'Whether the user has explicitly chosen to show their name on the leaderboard.';

CREATE TABLE IF NOT EXISTS study_sessions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  is_correct   BOOLEAN NOT NULL,
  points       INTEGER NOT NULL,
  studied_on   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- one session per user per day
  UNIQUE (user_id, studied_on)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date
  ON study_sessions (user_id, studied_on DESC);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  user_id       INTEGER PRIMARY KEY
                REFERENCES users(id) ON DELETE CASCADE,
  total_points  BIGINT NOT NULL DEFAULT 0,
  session_count BIGINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE leaderboard_scores IS
  'Transactionally maintained per-user rollup used by the leaderboard.';

COMMENT ON COLUMN leaderboard_scores.session_count IS
  'Distinguishes a zero-point studied user from a user with no sessions.';

INSERT INTO leaderboard_scores AS scores (
  user_id,
  total_points,
  session_count
)
SELECT
  user_id,
  SUM(points)::bigint,
  COUNT(*)::bigint
FROM study_sessions
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
SET
  total_points = EXCLUDED.total_points,
  session_count = EXCLUDED.session_count;

DELETE FROM leaderboard_scores AS scores
WHERE NOT EXISTS (
  SELECT 1
  FROM study_sessions AS sessions
  WHERE sessions.user_id = scores.user_id
);

ANALYZE leaderboard_scores;
