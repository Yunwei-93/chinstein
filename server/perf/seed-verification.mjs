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
} from './fixture-config.mjs'
import { inspectPerfSessionFacts } from './seed-fixture-inspection.mjs'

// Verify session dates, deterministic history, and pool behavior.
// The shared inspector collects facts; this function applies
// the strict post-seed policy.
export async function verifySeededSessionQuality(client, seedDate) {
  const facts = await inspectPerfSessionFacts(client, seedDate)

  if (seedDate !== facts.currentDate || seedDate !== facts.wallDate) {
    throw new PerfSafetyError('Session quality verification date changed')
  }

  if (!facts.sessionUserDateUniqueConstraint) {
    throw new PerfSafetyError('The user and study-date uniqueness contract is missing')
  }

  if (
    facts.studySessions !== HISTORICAL_SESSIONS + TODAY_SESSIONS ||
    facts.historicalSessions !== HISTORICAL_SESSIONS ||
    facts.fixtureDateSessions !== TODAY_SESSIONS
  ) {
    throw new PerfSafetyError('Historical or current-day session totals are incorrect')
  }

  if (
    facts.dateRange.minimum !== facts.expectedDateRange.minimum ||
    facts.dateRange.maximum !== facts.expectedDateRange.maximum ||
    facts.sessionsBeforeHistory !== 0 ||
    facts.sessionsAfterFixtureDate !== 0 ||
    facts.sessionsOutsideDateRange !== 0
  ) {
    throw new PerfSafetyError('Seeded session dates are outside the expected range')
  }

  if (facts.unmappedUserSessions !== 0 || facts.unmappedCharacterSessions !== 0) {
    throw new PerfSafetyError('Seeded sessions contain unmapped users or characters')
  }

  if (facts.invalidHistoricalSessions !== 0 || facts.invalidStrictFixtureDateSessions !== 0) {
    throw new PerfSafetyError('Seeded character, correctness, or point values are invalid')
  }

  if (
    facts.poolRFixtureDateSessions !== 0 ||
    facts.poolAFixtureDateSessions !== 0 ||
    facts.poolBFixtureDateSessions !== TODAY_SESSIONS
  ) {
    throw new PerfSafetyError('Strict post-seed pool distribution is incorrect')
  }

  return {
    studySessions: facts.studySessions,
    historicalSessions: facts.historicalSessions,
    todaySessions: facts.fixtureDateSessions,
    dateRange: facts.dateRange,
    sessionsOutsideDateRange: facts.sessionsOutsideDateRange,
    invalidHistoricalSessions: facts.invalidHistoricalSessions,
    invalidTodaySessions: facts.invalidStrictFixtureDateSessions,
    todayCharacterId: facts.dailyCharacterId,
    seedDate,
  }
}
// Define only; this function is not called yet.
// Verify the top-level fixture counts and deterministic identifiers.
export async function verifySeededStructure(client, seedDate) {
  const result = await client.query(
    `
        SELECT
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text AS wall_date,

            (
                SELECT COUNT(*) FROM public.users
            )::bigint AS users,

            (
                SELECT COUNT(*) FROM public.perf_users
            )::bigint AS user_mappings,

            (
                SELECT MIN(seq) FROM public.perf_users
            )::integer AS minimum_user_seq,

            (
                SELECT MAX(seq) FROM public.perf_users
            )::integer AS maximum_user_seq,

            (
                SELECT COUNT(*) FROM public.characters
            )::bigint AS characters,

            (
                SELECT COUNT(*) FROM public.perf_characters
            )::bigint AS character_mappings,

            (
                SELECT MIN(seq) FROM public.perf_characters
            )::integer AS minimum_character_seq,

            (
                SELECT MAX(seq) FROM public.perf_characters
            )::integer AS maximum_character_seq,

            (
                SELECT COUNT(*) FROM public.study_sessions
            )::bigint AS study_sessions,

            (
                SELECT COUNT(DISTINCT password_hash)
                FROM public.users
            )::bigint AS distinct_password_hashes,

            (
                SELECT COUNT(*)
                FROM public.users AS u
                JOIN public.perf_users AS pu
                    ON pu.user_id = u.id
                WHERE
                    u.name IS DISTINCT FROM
                        'player_' || LPAD(pu.seq::text, 5, '0')
                    OR u.email IS DISTINCT FROM
                        'player_' || LPAD(pu.seq::text, 5, '0')
                        || '@perf.invalid'
                    OR u.password_hash IS NULL
                    OR u.leaderboard_name_public IS NOT TRUE
            )::bigint AS invalid_fixture_users,

            (
                SELECT COUNT(*)
                FROM public.users AS u
                LEFT JOIN public.perf_users AS pu
                    ON pu.user_id = u.id
                WHERE pu.user_id IS NULL
            )::bigint AS unmapped_users,

            (
                SELECT COUNT(*)
                FROM public.study_sessions AS s
                LEFT JOIN public.perf_users AS pu
                    ON pu.user_id = s.user_id
                WHERE pu.user_id IS NULL
            )::bigint AS unmapped_sessions,

            (
                SELECT COUNT(*)
                FROM public.characters AS c
                LEFT JOIN public.perf_characters AS pc
                    ON pc.character_id = c.id
                WHERE pc.character_id IS NULL
            )::bigint AS unmapped_characters,

            (
                SELECT COUNT(*)
                FROM (
                    SELECT
                        id AS character_id,
                        (
                            ROW_NUMBER() OVER (ORDER BY id)
                        )::integer AS expected_seq
                    FROM public.characters
                ) AS expected
                JOIN public.perf_characters AS pc
                    ON pc.character_id = expected.character_id
                WHERE pc.seq IS DISTINCT FROM expected.expected_seq
            )::bigint AS mismatched_character_mappings,

            (
                SELECT COUNT(*)
                FROM public.characters
                WHERE
                    story IS DISTINCT FROM $1
                    OR story_status IS DISTINCT FROM 'ready'
                    OR story_source IS DISTINCT FROM $2
                    OR story_attempts IS DISTINCT FROM 0
                    OR story_started_at IS NOT NULL
            )::bigint AS invalid_synthetic_stories
    `,
    [SYNTHETIC_STORY, SYNTHETIC_STORY_SOURCE],
  )

  const state = result.rows[0]

  if (seedDate !== state.current_date || seedDate !== state.wall_date) {
    throw new PerfSafetyError('Seed verification date does not match the database date')
  }

  if (
    Number(state.users) !== TOTAL_USERS ||
    Number(state.user_mappings) !== TOTAL_USERS ||
    Number(state.characters) !== CHARACTER_COUNT ||
    Number(state.character_mappings) !== CHARACTER_COUNT ||
    Number(state.study_sessions) !== HISTORICAL_SESSIONS + TODAY_SESSIONS
  ) {
    throw new PerfSafetyError('Seeded core row counts do not match the frozen fixture')
  }

  if (
    Number(state.minimum_user_seq) !== 1 ||
    Number(state.maximum_user_seq) !== TOTAL_USERS ||
    Number(state.minimum_character_seq) !== 1 ||
    Number(state.maximum_character_seq) !== CHARACTER_COUNT
  ) {
    throw new PerfSafetyError('Synthetic mapping sequence ranges are incomplete')
  }

  if (
    Number(state.distinct_password_hashes) !== 1 ||
    Number(state.invalid_fixture_users) !== 0 ||
    Number(state.unmapped_users) !== 0 ||
    Number(state.unmapped_sessions) !== 0 ||
    Number(state.unmapped_characters) !== 0 ||
    Number(state.mismatched_character_mappings) !== 0 ||
    Number(state.invalid_synthetic_stories) !== 0
  ) {
    throw new PerfSafetyError('Seeded fixture integrity checks failed')
  }

  return {
    users: Number(state.users),
    userMappings: Number(state.user_mappings),
    userSequenceRange: {
      minimum: Number(state.minimum_user_seq),
      maximum: Number(state.maximum_user_seq),
    },
    characters: Number(state.characters),
    characterMappings: Number(state.character_mappings),
    characterSequenceRange: {
      minimum: Number(state.minimum_character_seq),
      maximum: Number(state.maximum_character_seq),
    },
    studySessions: Number(state.study_sessions),
    distinctPasswordHashes: Number(state.distinct_password_hashes),
    invalidFixtureUsers: Number(state.invalid_fixture_users),
    unmappedUsers: Number(state.unmapped_users),
    unmappedSessions: Number(state.unmapped_sessions),
    unmappedCharacters: Number(state.unmapped_characters),
    mismatchedCharacterMappings: Number(state.mismatched_character_mappings),
    invalidSyntheticStories: Number(state.invalid_synthetic_stories),
    seedDate,
  }
}

// Define only; this function is not called yet.
// Verify per-user history, pool behavior, score variation, and ties.
export async function verifySeededUserDistribution(client, seedDate) {
  const result = await client.query(
    `
        WITH per_user AS (
            SELECT
                pu.seq,

                COUNT(s.id) FILTER (
                    WHERE s.studied_on BETWEEN
                        $1::date - $2::integer
                        AND $1::date - 1
                )::bigint AS historical_sessions,

                COUNT(DISTINCT s.character_id) FILTER (
                    WHERE s.studied_on BETWEEN
                        $1::date - $2::integer
                        AND $1::date - 1
                )::bigint AS learned_characters,

                COUNT(s.id) FILTER (
                    WHERE s.studied_on = $1::date
                )::bigint AS today_sessions,

                COALESCE(
                    SUM(s.points),
                    0
                )::bigint AS total_points

            FROM public.perf_users AS pu
            LEFT JOIN public.study_sessions AS s
                ON s.user_id = pu.user_id
            GROUP BY pu.seq
        ),

        score_groups AS (
            SELECT
                total_points,
                COUNT(*)::bigint AS users_at_score
            FROM per_user
            GROUP BY total_points
        )

        SELECT
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text AS wall_date,

            (
                SELECT COUNT(*) FROM per_user
            )::bigint AS users,

            (
                SELECT COUNT(*)
                FROM per_user
                WHERE historical_sessions = $2::integer
            )::bigint AS users_with_complete_history,

            (
                SELECT COUNT(*)
                FROM per_user
                WHERE learned_characters = $2::integer
            )::bigint AS users_with_complete_learned_set,

            (
                SELECT COUNT(*)
                FROM per_user
                WHERE seq BETWEEN $3 AND $4
                  AND today_sessions = 0
            )::bigint AS non_conflict_users,

            (
                SELECT COUNT(*)
                FROM per_user
                WHERE seq BETWEEN $5 AND $6
                  AND today_sessions = 1
            )::bigint AS conflict_users,

            (
                SELECT MIN(historical_sessions)
                FROM per_user
            )::bigint AS minimum_history,

            (
                SELECT MAX(historical_sessions)
                FROM per_user
            )::bigint AS maximum_history,

            (
                SELECT MIN(today_sessions)
                FROM per_user
            )::bigint AS minimum_today_sessions,

            (
                SELECT MAX(today_sessions)
                FROM per_user
            )::bigint AS maximum_today_sessions,

            (
                SELECT MIN(total_points)
                FROM per_user
            )::bigint AS minimum_points,

            (
                SELECT MAX(total_points)
                FROM per_user
            )::bigint AS maximum_points,

            (
                SELECT COUNT(*)
                FROM score_groups
            )::bigint AS distinct_score_values,

            (
                SELECT COUNT(*)
                FROM score_groups
                WHERE users_at_score > 1
            )::bigint AS tied_score_groups,

            (
                SELECT COALESCE(MAX(users_at_score), 0)
                FROM score_groups
            )::bigint AS largest_tied_group
    `,
    [seedDate, HISTORY_DAYS, POOLS.R.firstSeq, POOLS.A.lastSeq, POOLS.B.firstSeq, POOLS.B.lastSeq],
  )

  const state = result.rows[0]
  const expectedNonConflictUsers = POOLS.R.users + POOLS.A.users

  if (seedDate !== state.current_date || seedDate !== state.wall_date) {
    throw new PerfSafetyError('Distribution verification date changed')
  }

  if (
    Number(state.users) !== TOTAL_USERS ||
    Number(state.users_with_complete_history) !== TOTAL_USERS ||
    Number(state.users_with_complete_learned_set) !== TOTAL_USERS
  ) {
    throw new PerfSafetyError('Per-user historical distribution is incomplete')
  }

  if (
    Number(state.non_conflict_users) !== expectedNonConflictUsers ||
    Number(state.conflict_users) !== POOLS.B.users ||
    Number(state.minimum_history) !== HISTORY_DAYS ||
    Number(state.maximum_history) !== HISTORY_DAYS ||
    Number(state.minimum_today_sessions) !== 0 ||
    Number(state.maximum_today_sessions) !== 1
  ) {
    throw new PerfSafetyError('Pool R, A, or B session distribution is incorrect')
  }

  if (
    Number(state.distinct_score_values) <= 1 ||
    Number(state.tied_score_groups) <= 0 ||
    Number(state.largest_tied_group) < 2 ||
    Number(state.minimum_points) >= Number(state.maximum_points)
  ) {
    throw new PerfSafetyError('Score variation or leaderboard ties are missing')
  }

  return {
    users: Number(state.users),
    usersWithCompleteHistory: Number(state.users_with_complete_history),
    usersWithCompleteLearnedSet: Number(state.users_with_complete_learned_set),
    nonConflictUsers: Number(state.non_conflict_users),
    conflictUsers: Number(state.conflict_users),
    historyRange: {
      minimum: Number(state.minimum_history),
      maximum: Number(state.maximum_history),
    },
    todaySessionRange: {
      minimum: Number(state.minimum_today_sessions),
      maximum: Number(state.maximum_today_sessions),
    },
    pointRange: {
      minimum: Number(state.minimum_points),
      maximum: Number(state.maximum_points),
    },
    distinctScoreValues: Number(state.distinct_score_values),
    tiedScoreGroups: Number(state.tied_score_groups),
    largestTiedGroup: Number(state.largest_tied_group),
    seedDate,
  }
}

// Prove that the leaderboard read model exactly matches its session source.
export async function verifyLeaderboardScores(client) {
  const result = await client.query(`
    WITH session_totals AS (
      SELECT
        user_id,
        SUM(points)::bigint AS total_points,
        COUNT(*)::bigint AS session_count
      FROM public.study_sessions
      GROUP BY user_id
    ),
    drift AS (
      SELECT COALESCE(source.user_id, scores.user_id) AS user_id
      FROM session_totals AS source
      FULL OUTER JOIN public.leaderboard_scores AS scores
        ON scores.user_id = source.user_id
      WHERE
        source.user_id IS NULL
        OR scores.user_id IS NULL
        OR source.total_points IS DISTINCT FROM scores.total_points
        OR source.session_count IS DISTINCT FROM scores.session_count
    )
    SELECT
      (
        SELECT COUNT(*) FROM public.leaderboard_scores
      )::bigint AS score_rows,
      (
        SELECT COALESCE(SUM(session_count), 0)
        FROM public.leaderboard_scores
      )::bigint AS scored_sessions,
      (
        SELECT COUNT(*) FROM drift
      )::bigint AS drifted_users
  `)

  const state = result.rows[0]
  const scoreRows = Number(state.score_rows)
  const scoredSessions = Number(state.scored_sessions)
  const driftedUsers = Number(state.drifted_users)

  if (
    scoreRows !== TOTAL_USERS ||
    scoredSessions !== HISTORICAL_SESSIONS + TODAY_SESSIONS ||
    driftedUsers !== 0
  ) {
    throw new PerfSafetyError('Leaderboard score verification failed')
  }

  return {
    scoreRows,
    scoredSessions,
    driftedUsers,
  }
}

// Define only; this function is not called yet.
// Refresh planner statistics after the complete dataset is seeded.
export async function analyzeSeededTables(client) {
  await client.query('ANALYZE public.study_sessions')
  await client.query('ANALYZE public.leaderboard_scores')
  await client.query('ANALYZE public.characters')
  await client.query('ANALYZE public.users')

  return {
    tablesAnalyzed: [
      'public.study_sessions',
      'public.leaderboard_scores',
      'public.characters',
      'public.users',
    ],
  }
}
