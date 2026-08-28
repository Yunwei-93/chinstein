

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

-- track provenance: hand-written vs model-generated
ALTER TABLE characters 
ADD COLUMN 
IF NOT EXISTS story_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'characters_story_status_check'
  ) THEN
    ALTER TABLE characters 
    ADD CONSTRAINT characters_story_status_check
      CHECK (story_status IN ('pending', 'generating', 'ready'));
  END IF;
END $$;

UPDATE characters
   SET story_status = 'ready',
       story_source = COALESCE(story_source, 'seed')
 WHERE story IS NOT NULL AND story_status <> 'ready';

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS won't touch an existing table, so alter explicitly
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

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