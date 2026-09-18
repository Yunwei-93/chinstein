import bcrypt from 'bcrypt'

import { requirePerfLoginPassword } from './p2/login-secret-contract.mjs'
import { PerfSafetyError } from './staging-guard.mjs'
import {
  HISTORY_DAYS,
  CHARACTER_COUNT,
  POOLS,
  TOTAL_USERS,
  HISTORICAL_SESSIONS,
  TODAY_SESSIONS,
  SYNTHETIC_STORY,
  SYNTHETIC_STORY_SOURCE,
  PERF_PASSWORD_HASH_ROUNDS,
} from './fixture-config.mjs'

const PERF_PASSWORD_HASH_PATTERN = /^\$2b\$10\$[./A-Za-z0-9]{53}$/

export function assertPerfPasswordHash(passwordHash) {
  if (typeof passwordHash !== 'string' || !PERF_PASSWORD_HASH_PATTERN.test(passwordHash)) {
    throw new PerfSafetyError('A valid PERF bcrypt password hash is required')
  }

  return passwordHash
}

export async function createPerfPasswordHash({
  environment = process.env,
  hashPassword = bcrypt.hash,
} = {}) {
  if (typeof hashPassword !== 'function') {
    throw new PerfSafetyError('PERF password-hash dependency is unavailable')
  }

  let loginPassword = null

  try {
    try {
      loginPassword = requirePerfLoginPassword(environment)
    } catch {
      throw new PerfSafetyError('PERF_LOGIN_PASSWORD is missing or invalid')
    }

    let passwordHash

    try {
      passwordHash = await hashPassword(loginPassword, PERF_PASSWORD_HASH_ROUNDS)
    } catch {
      throw new PerfSafetyError('Unable to create PERF password hash')
    }

    return assertPerfPasswordHash(passwordHash)
  } finally {
    loginPassword = null
  }
}

// Define the function only; it is not called yet.
// The caller must start a read-write transaction before invoking it.
export async function setSyntheticStories(client) {
  // Block concurrent updates to characters until the transaction ends.
  // Ordinary SELECT queries can still read the table.
  await client.query('LOCK TABLE public.characters IN SHARE ROW EXCLUSIVE MODE')

  // Recheck under the lock instead of relying on an earlier preview.
  const check = await client.query(
    `
    SELECT
      COUNT(*)::bigint AS characters,
      (
        SELECT COUNT(*)
        FROM public.characters
        WHERE story_status = $1
      )::bigint AS generating_stories
    FROM public.characters
  `,
    ['generating'],
  )

  const state = check.rows[0]

  if (Number(state.characters) !== CHARACTER_COUNT) {
    throw new PerfSafetyError('Character count changed; refusing to replace stories')
  }

  if (Number(state.generating_stories) !== 0) {
    throw new PerfSafetyError('Story generation is in progress; refusing to replace stories')
  }

  // No WHERE clause: intentionally update all 365 characters.
  const updated = await client.query(
    `
    UPDATE public.characters
    SET story = $1,
        story_status = $2,
        story_source = $3,
        story_attempts = 0,
        story_started_at = NULL
  `,
    [SYNTHETIC_STORY, 'ready', SYNTHETIC_STORY_SOURCE],
  )

  if (updated.rowCount !== CHARACTER_COUNT) {
    throw new PerfSafetyError('Unexpected story update count; the caller must roll back')
  }

  return {
    charactersUpdated: updated.rowCount,
    storyCharacters: SYNTHETIC_STORY.length,
    storyUtf8Bytes: Buffer.byteLength(SYNTHETIC_STORY, 'utf8'),
    storySource: SYNTHETIC_STORY_SOURCE,
  }
}

// Define only; this function is not called yet.
// Create today's existing sessions for the repeatable 409 pool.
export async function seedTodayConflictSessions(client, seedDate) {
  // Keep today's character, sessions, and user mappings stable.
  await client.query(`
        LOCK TABLE
            public.characters,
            public.study_sessions,
            public.perf_users
        IN SHARE ROW EXCLUSIVE MODE
    `)

  // Verify that history exists and today's rows do not exist yet.
  const check = await client.query(
    `
        SELECT
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text AS wall_date,
            (
                SELECT COUNT(*)
                FROM public.study_sessions
            )::bigint AS study_sessions,
            (
                SELECT COUNT(*)
                FROM public.study_sessions
                WHERE studied_on = CURRENT_DATE
            )::bigint AS today_sessions,
            (
                SELECT COUNT(*)
                FROM public.perf_users
                WHERE seq BETWEEN $1 AND $2
            )::bigint AS pool_b_users,
            (
                SELECT COUNT(*)
                FROM public.study_sessions AS s
                JOIN public.perf_users AS pu
                    ON pu.user_id = s.user_id
                WHERE pu.seq BETWEEN $1 AND $2
            )::bigint AS pool_b_history
    `,
    [POOLS.B.firstSeq, POOLS.B.lastSeq],
  )

  const state = check.rows[0]

  if (seedDate !== state.current_date || seedDate !== state.wall_date) {
    throw new PerfSafetyError('Seed date does not match the current database date')
  }

  if (
    Number(state.study_sessions) !== HISTORICAL_SESSIONS ||
    Number(state.today_sessions) !== 0 ||
    Number(state.pool_b_users) !== POOLS.B.users ||
    Number(state.pool_b_history) !== POOLS.B.users * HISTORY_DAYS
  ) {
    throw new PerfSafetyError('Pool B requires complete history and no current-day sessions')
  }

  // Use exactly the same date-based ordering rule as the application.
  const today = await client.query(`
        SELECT
            id,
            story,
            story_status,
            story_source,
            story_attempts
        FROM public.characters
        ORDER BY id
        OFFSET (
            SELECT
                (
                    EXTRACT(EPOCH FROM CURRENT_DATE)::bigint / 86400
                ) % GREATEST(COUNT(*), 1)
            FROM public.characters
        )
        LIMIT 1
    `)

  const todayCharacter = today.rows[0]

  if (
    !todayCharacter ||
    todayCharacter.story !== SYNTHETIC_STORY ||
    todayCharacter.story_status !== 'ready' ||
    todayCharacter.story_source !== SYNTHETIC_STORY_SOURCE ||
    Number(todayCharacter.story_attempts) !== 0
  ) {
    throw new PerfSafetyError("Today's character is not the canonical ready synthetic fixture")
  }

  // Give every Pool B user one current-day row for the same character.
  const inserted = await client.query(
    `
        INSERT INTO public.study_sessions (
            user_id,
            character_id,
            is_correct,
            points,
            studied_on
        )
        SELECT
            pu.user_id,
            $1,
            TRUE,
            20,
            $2::date
        FROM public.perf_users AS pu
        WHERE pu.seq BETWEEN $3 AND $4
    `,
    [todayCharacter.id, seedDate, POOLS.B.firstSeq, POOLS.B.lastSeq],
  )

  if (inserted.rowCount !== TODAY_SESSIONS) {
    throw new PerfSafetyError('Unexpected Pool B insert count; the caller must roll back')
  }

  // Detect a date rollover before allowing the caller to commit.
  const end = await client.query(`
        SELECT clock_timestamp()::date::text AS wall_date
    `)

  if (end.rows[0].wall_date !== seedDate) {
    throw new PerfSafetyError('Database date changed during Pool B insertion; roll back')
  }

  return {
    todaySessionsInserted: inserted.rowCount,
    todayCharacterId: todayCharacter.id,
    seedDate,
  }
}

// Define only; this function is not called yet.
// The caller must verify staging, start a transaction,
// prepare both mappings, and supply the database seed date.
export async function seedHistoricalSessions(client, seedDate) {
  // Keep sessions and mappings stable during history insertion.
  await client.query(`
        LOCK TABLE
            public.study_sessions,
            public.perf_users,
            public.perf_characters
        IN SHARE ROW EXCLUSIVE MODE
    `)

  // Check the date and fixture prerequisites before inserting.
  const check = await client.query(`
        SELECT
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text AS wall_date,
            (
                SELECT COUNT(*) FROM public.perf_users
            )::bigint AS users,
            (
                SELECT COUNT(*) FROM public.perf_characters
            )::bigint AS characters,
            (
                SELECT COUNT(*) FROM public.study_sessions
            )::bigint AS study_sessions
    `)

  const state = check.rows[0]

  if (seedDate !== state.current_date || seedDate !== state.wall_date) {
    throw new PerfSafetyError('Seed date does not match the current database date')
  }

  if (
    Number(state.users) !== TOTAL_USERS ||
    Number(state.characters) !== CHARACTER_COUNT ||
    Number(state.study_sessions) !== 0
  ) {
    throw new PerfSafetyError('History requires complete mappings and an empty sessions table')
  }

  // Derive characters and correctness from synthetic sequences only.
  // Insert days 1 through 180 before the recorded database seed date.
  const inserted = await client.query(
    `
        INSERT INTO public.study_sessions (
            user_id,
            character_id,
            is_correct,
            points,
            studied_on
        )
        SELECT
            pu.user_id,
            pc.character_id,
            ((pu.seq * 31 + d.day) % 100) < (40 + (pu.seq % 50)),
            CASE
                WHEN ((pu.seq * 31 + d.day) % 100)
                    < (40 + (pu.seq % 50))
                THEN 20
                ELSE 0
            END,
            $2::date - d.day
        FROM public.perf_users AS pu
        CROSS JOIN generate_series(1, $1::integer) AS d(day)
        JOIN public.perf_characters AS pc
            ON pc.seq = 1 + ((pu.seq * 7 + d.day) % $3::integer)
    `,
    [HISTORY_DAYS, seedDate, CHARACTER_COUNT],
  )

  if (inserted.rowCount !== HISTORICAL_SESSIONS) {
    throw new PerfSafetyError('Unexpected history insert count; the caller must roll back')
  }

  // CURRENT_DATE stays fixed within a transaction; check the live clock.
  const end = await client.query(`
        SELECT clock_timestamp()::date::text AS wall_date
    `)

  if (end.rows[0].wall_date !== seedDate) {
    throw new PerfSafetyError('Database date changed during history insertion; roll back')
  }

  return {
    historicalSessionsInserted: inserted.rowCount,
    historyDaysPerUser: HISTORY_DAYS,
    seedDate,
  }
}

// Define only; this function is not called yet.
// The caller must verify staging, start a transaction,
// create the mapping tables, and supply a generated password hash.
export async function createPerfUsers(client, passwordHash) {
  // Never include the password hash in errors or output.
  const approvedPasswordHash = assertPerfPasswordHash(passwordHash)

  // Prevent concurrent changes while checking and inserting users.
  await client.query(`
        LOCK TABLE public.users, public.perf_users
        IN SHARE ROW EXCLUSIVE MODE
    `)

  // Refuse to append fixtures to an existing user dataset.
  const check = await client.query(`
        SELECT
            (
                SELECT COUNT(*) FROM public.users
            )::bigint AS users,
            (
                SELECT COUNT(*) FROM public.perf_users
            )::bigint AS user_mappings
    `)

  const state = check.rows[0]

  if (Number(state.users) !== 0 || Number(state.user_mappings) !== 0) {
    throw new PerfSafetyError('Users and user mappings must be empty before seeding')
  }

  // Create fixed-width names and emails from stable synthetic sequences.
  // Reuse one generated hash and make synthetic display names public.
  const inserted = await client.query(
    `
        INSERT INTO public.users (
            name,
            email,
            password_hash,
            leaderboard_name_public
        )
        SELECT
            'player_' || LPAD(g.seq::text, 5, '0'),
            'player_' || LPAD(g.seq::text, 5, '0') || '@perf.invalid',
            $2,
            TRUE
        FROM generate_series(1, $1::integer) AS g(seq)
    `,
    [TOTAL_USERS, approvedPasswordHash],
  )

  if (inserted.rowCount !== TOTAL_USERS) {
    throw new PerfSafetyError('Unexpected user insert count; the caller must roll back')
  }

  // Resolve actual user IDs by deterministic unique emails.
  // Never derive synthetic sequences from physical SERIAL IDs.
  const mapped = await client.query(
    `
        INSERT INTO public.perf_users (seq, user_id)
        SELECT
            g.seq,
            u.id
        FROM generate_series(1, $1::integer) AS g(seq)
        JOIN public.users AS u
            ON u.email =
                'player_' || LPAD(g.seq::text, 5, '0') || '@perf.invalid'
    `,
    [TOTAL_USERS],
  )

  if (mapped.rowCount !== TOTAL_USERS) {
    throw new PerfSafetyError('Unexpected user mapping count; the caller must roll back')
  }

  return {
    usersCreated: inserted.rowCount,
    userMappingsCreated: mapped.rowCount,
  }
}

// Define only; this function is not called yet.
export async function createPerfMappings(client) {
  // Require an explicit transaction and keep the character set stable.
  await client.query('LOCK TABLE public.characters IN SHARE ROW EXCLUSIVE MODE')

  // Map stable synthetic user sequences to actual database user IDs.
  await client.query(`
    CREATE TABLE public.perf_users (
      seq INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE
        REFERENCES public.users(id) ON DELETE CASCADE
    )
  `)

  // Map stable character sequences to actual database character IDs.
  await client.query(`
    CREATE TABLE public.perf_characters (
      seq INTEGER PRIMARY KEY,
      character_id INTEGER NOT NULL UNIQUE
        REFERENCES public.characters(id)
    )
  `)

  // Assign sequences from the actual character rows, ordered by ID.
  const mapped = await client.query(`
    INSERT INTO public.perf_characters (seq, character_id)
    SELECT ROW_NUMBER() OVER (ORDER BY id), id
    FROM public.characters
  `)

  if (mapped.rowCount !== CHARACTER_COUNT) {
    throw new PerfSafetyError('Unexpected character mapping count; the caller must roll back')
  }

  return {
    characterMappingsCreated: mapped.rowCount,
  }
}

// Define only; this function is not called yet.
// The caller must verify staging and start a read-write transaction.
export async function clearStagingDataset(client) {
  // Fail instead of waiting indefinitely for active staging requests.
  await client.query('SET LOCAL lock_timeout = 5000')
  await client.query('SET LOCAL statement_timeout = 60000')

  // Keep the dataset stable until the caller commits or rolls back.
  // These locks temporarily block other reads and writes.
  await client.query(`
        LOCK TABLE
            public.users,
            public.study_sessions,
            public.characters
        IN ACCESS EXCLUSIVE MODE
    `)

  // Recheck the character set and generation state under the locks.
  const check = await client.query(
    `
        SELECT
            (
                SELECT COUNT(*) FROM public.characters
            )::bigint AS characters,
            (
                SELECT COUNT(*)
                FROM public.characters
                WHERE story_status = $1
            )::bigint AS generating_stories,
            (
                SELECT COUNT(*) FROM public.study_sessions
            )::bigint AS study_sessions
    `,
    ['generating'],
  )

  const state = check.rows[0]

  if (Number(state.characters) !== CHARACTER_COUNT) {
    throw new PerfSafetyError('Character count changed; refusing to clear staging data')
  }

  if (Number(state.generating_stories) !== 0) {
    throw new PerfSafetyError('Story generation is in progress; refusing to clear staging data')
  }

  const mappings = await client.query(
    `
        SELECT to_regclass($1)::text AS perf_users_table
    `,
    ['public.perf_users'],
  )

  // Clear sessions without cascading to other tables or resetting IDs.
  await client.query('TRUNCATE TABLE public.study_sessions')

  let mappedUsersDeleted = 0

  if (mappings.rows[0].perf_users_table !== null) {
    // Use the existing mapping before removing it.
    const deleted = await client.query(`
            DELETE FROM public.users AS u
            USING public.perf_users AS pu
            WHERE u.id = pu.user_id
        `)

    mappedUsersDeleted = deleted.rowCount
  }

  // Full staging normalization was explicitly approved.
  const remaining = await client.query('DELETE FROM public.users')

  // Do not cascade to unexpected dependent objects.
  await client.query(`
        DROP TABLE IF EXISTS
            public.perf_users,
            public.perf_characters
    `)

  return {
    sessionsCleared: Number(state.study_sessions),
    mappedUsersDeleted,
    remainingUsersDeleted: remaining.rowCount,
    charactersPreserved: Number(state.characters),
  }
}
