--  idempotent: safe to run more than once
CREATE TABLE IF NOT EXISTS characters (
  id         SERIAL PRIMARY KEY,
  character  TEXT NOT NULL UNIQUE,
  pinyin     TEXT NOT NULL,
  meaning    TEXT NOT NULL,
  story      TEXT NOT NULL,
  level      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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