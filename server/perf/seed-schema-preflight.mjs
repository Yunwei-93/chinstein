import { PerfSafetyError } from './staging-guard.mjs'

const CORE_RELATIONS = ['characters', 'study_sessions', 'users']

// Define only; this function is not called yet.
// Verify the core objects are ordinary tables without hidden behavior.
export async function assertCoreRelations(client) {
  const result = await client.query(
    `
        SELECT
            c.relname AS relation_name,
            c.relkind,
            c.relrowsecurity AS row_security_enabled,
            c.relforcerowsecurity AS row_security_forced,
            row_security_active(c.oid)
                AS row_security_active,

            (
                SELECT COUNT(*)
                FROM pg_catalog.pg_trigger AS t
                WHERE
                    t.tgrelid = c.oid
                    AND NOT t.tgisinternal
                    AND t.tgenabled <> 'D'
            )::integer AS enabled_user_triggers

        FROM pg_catalog.pg_class AS c

        JOIN pg_catalog.pg_namespace AS n
            ON n.oid = c.relnamespace

        WHERE
            n.nspname = 'public'
            AND c.relname = ANY($1::text[])

        ORDER BY c.relname
    `,
    [CORE_RELATIONS],
  )

  const relations = new Map(result.rows.map((row) => [row.relation_name, row]))

  const failures = []

  for (const relationName of CORE_RELATIONS) {
    const state = relations.get(relationName)

    if (!state) {
      failures.push(`public.${relationName}:missing`)
      continue
    }

    if (state.relkind !== 'r') {
      failures.push(`public.${relationName}:not-an-ordinary-table`)
    }

    if (state.row_security_enabled || state.row_security_forced || state.row_security_active) {
      failures.push(`public.${relationName}:row-security-active`)
    }

    if (Number(state.enabled_user_triggers) !== 0) {
      failures.push(`public.${relationName}:unexpected-user-trigger`)
    }
  }

  if (failures.length > 0) {
    throw new PerfSafetyError(`Core relation checks failed: ${failures.join(', ')}`)
  }

  return {
    relationsChecked: CORE_RELATIONS.length,
    ordinaryTables: CORE_RELATIONS.length,
    rowSecurityRelations: 0,
    enabledUserTriggers: 0,
  }
}

// Define only; this function is not called yet.
// Verify the complete column contract used by the PERF fixture.
export async function assertCoreColumns(client) {
  const result = await client.query(
    `
        WITH expected (
            table_name,
            column_name,
            data_type,
            is_nullable,
            has_default
        ) AS (
            VALUES
                (
                    'characters'::text,
                    'id'::text,
                    'integer'::text,
                    FALSE,
                    TRUE
                ),
                (
                    'characters',
                    'character',
                    'text',
                    FALSE,
                    FALSE
                ),
                (
                    'characters',
                    'pinyin',
                    'text',
                    FALSE,
                    FALSE
                ),
                (
                    'characters',
                    'meaning',
                    'text',
                    FALSE,
                    FALSE
                ),
                (
                    'characters',
                    'story',
                    'text',
                    TRUE,
                    FALSE
                ),
                (
                    'characters',
                    'level',
                    'text',
                    FALSE,
                    FALSE
                ),
                (
                    'characters',
                    'story_status',
                    'text',
                    FALSE,
                    TRUE
                ),
                (
                    'characters',
                    'story_started_at',
                    'timestamp with time zone',
                    TRUE,
                    FALSE
                ),
                (
                    'characters',
                    'story_attempts',
                    'integer',
                    FALSE,
                    TRUE
                ),
                (
                    'characters',
                    'story_source',
                    'text',
                    TRUE,
                    FALSE
                ),

                (
                    'users',
                    'id',
                    'integer',
                    FALSE,
                    TRUE
                ),
                (
                    'users',
                    'name',
                    'text',
                    FALSE,
                    FALSE
                ),
                (
                    'users',
                    'leaderboard_name_public',
                    'boolean',
                    FALSE,
                    TRUE
                ),
                (
                    'users',
                    'email',
                    'text',
                    TRUE,
                    FALSE
                ),
                (
                    'users',
                    'password_hash',
                    'text',
                    TRUE,
                    FALSE
                ),
                (
                    'users',
                    'created_at',
                    'timestamp with time zone',
                    FALSE,
                    TRUE
                ),

                (
                    'study_sessions',
                    'id',
                    'integer',
                    FALSE,
                    TRUE
                ),
                (
                    'study_sessions',
                    'user_id',
                    'integer',
                    FALSE,
                    FALSE
                ),
                (
                    'study_sessions',
                    'character_id',
                    'integer',
                    FALSE,
                    FALSE
                ),
                (
                    'study_sessions',
                    'is_correct',
                    'boolean',
                    FALSE,
                    FALSE
                ),
                (
                    'study_sessions',
                    'points',
                    'integer',
                    FALSE,
                    FALSE
                ),
                (
                    'study_sessions',
                    'studied_on',
                    'date',
                    FALSE,
                    FALSE
                ),
                (
                    'study_sessions',
                    'created_at',
                    'timestamp with time zone',
                    FALSE,
                    TRUE
                )
        ),

        actual AS (
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable = 'YES' AS is_nullable,
                c.column_default IS NOT NULL AS has_default

            FROM information_schema.columns AS c

            WHERE
                c.table_schema = 'public'
                AND c.table_name = ANY($1::text[])
        ),

        differences AS (
            SELECT
                COALESCE(
                    e.table_name,
                    a.table_name
                ) AS table_name,

                COALESCE(
                    e.column_name,
                    a.column_name
                ) AS column_name,

                CASE
                    WHEN e.table_name IS NULL
                        THEN 'unexpected-column'
                    WHEN a.table_name IS NULL
                        THEN 'missing-column'
                    ELSE 'definition-mismatch'
                END AS reason

            FROM expected AS e

            FULL OUTER JOIN actual AS a
                USING (table_name, column_name)

            WHERE
                e.table_name IS NULL
                OR a.table_name IS NULL
                OR e.data_type IS DISTINCT FROM a.data_type
                OR e.is_nullable IS DISTINCT FROM a.is_nullable
                OR e.has_default IS DISTINCT FROM a.has_default
        )

        SELECT
            (
                SELECT COUNT(*) FROM expected
            )::integer AS expected_columns,

            (
                SELECT COUNT(*) FROM actual
            )::integer AS actual_columns,

            ARRAY(
                SELECT
                    table_name
                    || '.'
                    || column_name
                    || ':'
                    || reason
                FROM differences
                ORDER BY table_name, column_name
            ) AS differences
    `,
    [CORE_RELATIONS],
  )

  const state = result.rows[0]
  const differences = state.differences ?? []

  if (differences.length > 0) {
    throw new PerfSafetyError(`Core column checks failed: ${differences.join(', ')}`)
  }

  return {
    expectedColumns: Number(state.expected_columns),
    actualColumns: Number(state.actual_columns),
    columnDifferences: 0,
  }
}
