import { PerfSafetyError } from './staging-guard.mjs'

import { HISTORY_DAYS, CHARACTER_COUNT, POOLS } from './fixture-config.mjs'

const CORRECT_POINTS = 20

function assertIsoDateShape(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PerfSafetyError('Fixture date must use YYYY-MM-DD format')
  }
}

function toSafeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw new PerfSafetyError(`Missing integer value for ${fieldName}`)
  }

  const normalized = Number(value)

  if (!Number.isSafeInteger(normalized)) {
    throw new PerfSafetyError(`Invalid integer value for ${fieldName}`)
  }

  return normalized
}

function toBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new PerfSafetyError(`Invalid boolean value for ${fieldName}`)
  }

  return value
}

// Collect fixed-size aggregate facts about the PERF session fixture.
// This function reads database state but never changes it.
export async function inspectPerfSessionFacts(client, fixtureDate) {
  if (!client || typeof client.query !== 'function') {
    throw new PerfSafetyError('Session inspection requires a database client')
  }

  assertIsoDateShape(fixtureDate)

  const result = await client.query(
    `
        WITH fixture_constants AS (
            SELECT
                (
                    SELECT pc.character_id
                    FROM public.perf_characters AS pc
                    WHERE pc.seq =
                        1 + (
                            (
                                EXTRACT(
                                    EPOCH FROM $1::date
                                )::bigint / 86400
                            ) % $3::integer
                        )
                ) AS daily_character_id
        ),

        session_unique_contract AS (
            SELECT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_constraint
                    AS constraint_record
                WHERE
                    constraint_record.conrelid =
                        'public.study_sessions'::regclass
                    AND constraint_record.contype
                        IN ('u', 'p')
                    AND ARRAY(
                        SELECT attribute.attname::text
                        FROM unnest(
                            constraint_record.conkey
                        ) WITH ORDINALITY
                            AS key_column(
                                attnum,
                                position
                            )
                        JOIN pg_catalog.pg_attribute
                            AS attribute
                            ON attribute.attrelid =
                                constraint_record.conrelid
                            AND attribute.attnum =
                                key_column.attnum
                        ORDER BY key_column.position
                    ) = ARRAY[
                        'user_id',
                        'studied_on'
                    ]::text[]
            ) AS user_date_unique
        ),

        session_audit AS (
            SELECT
                COUNT(*)::bigint
                    AS study_sessions,

                COUNT(*) FILTER (
                    WHERE s.studied_on BETWEEN
                        $1::date - $2::integer
                        AND $1::date - 1
                )::bigint
                    AS historical_sessions,

                COUNT(*) FILTER (
                    WHERE s.studied_on = $1::date
                )::bigint
                    AS fixture_date_sessions,

                COUNT(*) FILTER (
                    WHERE s.studied_on <
                        $1::date - $2::integer
                )::bigint
                    AS sessions_before_history,

                COUNT(*) FILTER (
                    WHERE s.studied_on > $1::date
                )::bigint
                    AS sessions_after_fixture_date,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on <
                            $1::date - $2::integer
                        OR s.studied_on > $1::date
                )::bigint
                    AS sessions_outside_date_range,

                COUNT(*) FILTER (
                    WHERE pu.seq IS NULL
                )::bigint
                    AS unmapped_user_sessions,

                COUNT(*) FILTER (
                    WHERE pc.seq IS NULL
                )::bigint
                    AS unmapped_character_sessions,

                MIN(s.studied_on)::text
                    AS minimum_date,

                MAX(s.studied_on)::text
                    AS maximum_date,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on BETWEEN
                            $1::date - $2::integer
                            AND $1::date - 1
                        AND (
                            pu.seq IS NULL
                            OR pc.seq IS NULL
                            OR pc.seq IS DISTINCT FROM
                                1 + (
                                    (
                                        pu.seq * 7
                                        + (
                                            $1::date
                                            - s.studied_on
                                        )
                                    ) % $3::integer
                                )
                            OR s.is_correct IS DISTINCT FROM
                                (
                                    (
                                        pu.seq * 31
                                        + (
                                            $1::date
                                            - s.studied_on
                                        )
                                    ) % 100
                                ) < (
                                    40
                                    + (pu.seq % 50)
                                )
                            OR s.points IS DISTINCT FROM
                                CASE
                                    WHEN (
                                        (
                                            pu.seq * 31
                                            + (
                                                $1::date
                                                - s.studied_on
                                            )
                                        ) % 100
                                    ) < (
                                        40
                                        + (pu.seq % 50)
                                    )
                                    THEN $10::integer
                                    ELSE 0
                                END
                        )
                )::bigint
                    AS invalid_historical_sessions,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on = $1::date
                        AND (
                            pu.seq IS NULL
                            OR pu.seq NOT BETWEEN $8 AND $9
                            OR s.character_id
                                IS DISTINCT FROM
                                fixture.daily_character_id
                            OR s.is_correct IS NOT TRUE
                            OR s.points IS DISTINCT FROM
                                $10::integer
                        )
                )::bigint
                    AS invalid_strict_fixture_sessions,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on = $1::date
                        AND NOT COALESCE(
                            (
                                s.character_id
                                    IS NOT DISTINCT FROM
                                    fixture.daily_character_id
                                AND (
                                    (
                                        pu.seq BETWEEN $6 AND $7
                                        AND (
                                            (
                                                s.is_correct IS TRUE
                                                AND s.points
                                                    IS NOT DISTINCT FROM
                                                    $10::integer
                                            )
                                            OR (
                                                s.is_correct IS FALSE
                                                AND s.points
                                                    IS NOT DISTINCT FROM 0
                                            )
                                        )
                                    )
                                    OR (
                                        pu.seq BETWEEN $8 AND $9
                                        AND s.is_correct IS TRUE
                                        AND s.points
                                            IS NOT DISTINCT FROM
                                            $10::integer
                                    )
                                )
                            ),
                            FALSE
                        )
                )::bigint
                    AS invalid_reseed_fixture_sessions,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on = $1::date
                        AND pu.seq BETWEEN $4 AND $5
                )::bigint
                    AS pool_r_fixture_sessions,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on = $1::date
                        AND pu.seq BETWEEN $6 AND $7
                )::bigint
                    AS pool_a_fixture_sessions,

                COUNT(*) FILTER (
                    WHERE
                        s.studied_on = $1::date
                        AND pu.seq BETWEEN $8 AND $9
                )::bigint
                    AS pool_b_fixture_sessions

            FROM public.study_sessions AS s

            LEFT JOIN public.perf_users AS pu
                ON pu.user_id = s.user_id

            LEFT JOIN public.perf_characters AS pc
                ON pc.character_id = s.character_id

            CROSS JOIN fixture_constants AS fixture
        )

        SELECT
            $1::date::text
                AS fixture_date,

            CURRENT_DATE::text
                AS current_date,

            clock_timestamp()::date::text
                AS wall_date,

            fixture.daily_character_id,

            contract.user_date_unique,

            audit.study_sessions,
            audit.historical_sessions,
            audit.fixture_date_sessions,
            audit.sessions_before_history,
            audit.sessions_after_fixture_date,
            audit.sessions_outside_date_range,
            audit.unmapped_user_sessions,
            audit.unmapped_character_sessions,
            audit.minimum_date,
            audit.maximum_date,

            (
                $1::date - $2::integer
            )::text AS expected_minimum_date,

            $1::date::text
                AS expected_maximum_date,

            audit.invalid_historical_sessions,
            audit.invalid_strict_fixture_sessions,
            audit.invalid_reseed_fixture_sessions,
            audit.pool_r_fixture_sessions,
            audit.pool_a_fixture_sessions,
            audit.pool_b_fixture_sessions

        FROM fixture_constants AS fixture

        CROSS JOIN session_unique_contract AS contract

        CROSS JOIN session_audit AS audit
    `,
    [
      fixtureDate,
      HISTORY_DAYS,
      CHARACTER_COUNT,
      POOLS.R.firstSeq,
      POOLS.R.lastSeq,
      POOLS.A.firstSeq,
      POOLS.A.lastSeq,
      POOLS.B.firstSeq,
      POOLS.B.lastSeq,
      CORRECT_POINTS,
    ],
  )

  const state = result.rows[0]

  if (!state) {
    throw new PerfSafetyError('Session inspection returned no aggregate result')
  }

  if (state.fixture_date !== fixtureDate) {
    throw new PerfSafetyError('Database changed the supplied fixture date')
  }

  const integerFields = [
    'daily_character_id',
    'study_sessions',
    'historical_sessions',
    'fixture_date_sessions',
    'sessions_before_history',
    'sessions_after_fixture_date',
    'sessions_outside_date_range',
    'unmapped_user_sessions',
    'unmapped_character_sessions',
    'invalid_historical_sessions',
    'invalid_strict_fixture_sessions',
    'invalid_reseed_fixture_sessions',
    'pool_r_fixture_sessions',
    'pool_a_fixture_sessions',
    'pool_b_fixture_sessions',
  ]

  const numbers = Object.fromEntries(
    integerFields.map((fieldName) => [fieldName, toSafeInteger(state[fieldName], fieldName)]),
  )

  return {
    fixtureDate: state.fixture_date,
    currentDate: state.current_date,
    wallDate: state.wall_date,

    dailyCharacterId: numbers.daily_character_id,

    sessionUserDateUniqueConstraint: toBoolean(state.user_date_unique, 'user_date_unique'),

    studySessions: numbers.study_sessions,
    historicalSessions: numbers.historical_sessions,
    fixtureDateSessions: numbers.fixture_date_sessions,

    dateRange: {
      minimum: state.minimum_date,
      maximum: state.maximum_date,
    },

    expectedDateRange: {
      minimum: state.expected_minimum_date,
      maximum: state.expected_maximum_date,
    },

    sessionsBeforeHistory: numbers.sessions_before_history,
    sessionsAfterFixtureDate: numbers.sessions_after_fixture_date,
    sessionsOutsideDateRange: numbers.sessions_outside_date_range,
    unmappedUserSessions: numbers.unmapped_user_sessions,
    unmappedCharacterSessions: numbers.unmapped_character_sessions,
    invalidHistoricalSessions: numbers.invalid_historical_sessions,
    invalidStrictFixtureDateSessions: numbers.invalid_strict_fixture_sessions,
    invalidReseedFixtureDateSessions: numbers.invalid_reseed_fixture_sessions,
    poolRFixtureDateSessions: numbers.pool_r_fixture_sessions,
    poolAFixtureDateSessions: numbers.pool_a_fixture_sessions,
    poolBFixtureDateSessions: numbers.pool_b_fixture_sessions,
  }
}
