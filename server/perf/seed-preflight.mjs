import { PerfSafetyError } from './staging-guard.mjs'

const EXPECTED_DATABASE = 'neondb'
const UTC_MIDNIGHT_GUARD_SECONDS = 30 * 60

// Define only; this function is not called yet.
// The caller must start a transaction before invoking it.
// Define only; this function is not called yet.
// The caller must start a transaction before invoking it.
export async function assertSafeSeedClock(client, { requireReadWrite = false } = {}) {
  if (typeof requireReadWrite !== 'boolean') {
    throw new PerfSafetyError('requireReadWrite must be a boolean')
  }

  // Make every date expression in this transaction explicitly use UTC.
  await client.query("SET LOCAL TIME ZONE 'UTC'")

  const result = await client.query(`
        SELECT
            current_database() AS database,
            current_setting('TimeZone') AS timezone,
            current_setting(
                'transaction_read_only'
            ) AS transaction_read_only,
            pg_is_in_recovery() AS in_recovery,
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text AS wall_date,

            FLOOR(
                EXTRACT(
                    EPOCH FROM (
                        clock_timestamp()
                        - date_trunc('day', clock_timestamp())
                    )
                )
            )::integer AS seconds_since_midnight,

            FLOOR(
                EXTRACT(
                    EPOCH FROM (
                        date_trunc('day', clock_timestamp())
                        + INTERVAL '1 day'
                        - clock_timestamp()
                    )
                )
            )::integer AS seconds_until_midnight
    `)

  const state = result.rows[0]
  const secondsSinceMidnight = Number(state.seconds_since_midnight)
  const secondsUntilMidnight = Number(state.seconds_until_midnight)

  if (state.database !== EXPECTED_DATABASE) {
    throw new PerfSafetyError('Seed transaction is connected to the wrong database')
  }

  if (state.timezone !== 'UTC') {
    throw new PerfSafetyError('Seed transaction could not establish the UTC timezone')
  }

  if (state.in_recovery) {
    throw new PerfSafetyError('Seed transaction is connected to a recovery replica')
  }

  if (requireReadWrite && state.transaction_read_only !== 'off') {
    throw new PerfSafetyError('Seed transaction is read-only')
  }

  if (state.current_date !== state.wall_date) {
    throw new PerfSafetyError('Database transaction date differs from the live UTC date')
  }

  if (
    !Number.isFinite(secondsSinceMidnight) ||
    !Number.isFinite(secondsUntilMidnight) ||
    secondsSinceMidnight <= UTC_MIDNIGHT_GUARD_SECONDS ||
    secondsUntilMidnight <= UTC_MIDNIGHT_GUARD_SECONDS
  ) {
    throw new PerfSafetyError('Seed operation is inside the UTC midnight safety window')
  }

  return {
    database: state.database,
    timezone: state.timezone,
    seedDate: state.current_date,
    transactionReadOnly: state.transaction_read_only,
    inRecovery: state.in_recovery,
    writeModeRequired: requireReadWrite,
    secondsSinceMidnight,
    secondsUntilMidnight,
    midnightGuardSeconds: UTC_MIDNIGHT_GUARD_SECONDS,
  }
}

// Define only; this function is not called yet.
// Verify every privilege required by the seed and verification workflow.
export async function assertSeedPrivileges(client) {
  const result = await client.query(`
        WITH required_table_privileges (
            relation_name,
            privilege_name
        ) AS (
            VALUES
                ('public.users'::text, 'SELECT'::text),
                ('public.users', 'INSERT'),
                ('public.users', 'DELETE'),
                ('public.users', 'REFERENCES'),
                ('public.users', 'MAINTAIN'),

                ('public.study_sessions', 'SELECT'),
                ('public.study_sessions', 'INSERT'),
                ('public.study_sessions', 'TRUNCATE'),
                ('public.study_sessions', 'MAINTAIN'),

                ('public.characters', 'SELECT'),
                ('public.characters', 'UPDATE'),
                ('public.characters', 'REFERENCES'),
                ('public.characters', 'MAINTAIN')
        ),

        required_sequence_privileges (
            sequence_label,
            sequence_name,
            privilege_name
        ) AS (
            VALUES
                (
                    'public.users.id'::text,
                    pg_get_serial_sequence(
                        'public.users',
                        'id'
                    ),
                    'USAGE'::text
                ),
                (
                    'public.study_sessions.id',
                    pg_get_serial_sequence(
                        'public.study_sessions',
                        'id'
                    ),
                    'USAGE'
                )
        ),

        required_schema_privileges (
            schema_name,
            privilege_name
        ) AS (
            VALUES
                ('public'::text, 'USAGE'::text),
                ('public', 'CREATE')
        )

        SELECT
            ARRAY(
                SELECT
                    relation_name || ':' || privilege_name
                FROM required_table_privileges
                WHERE NOT has_table_privilege(
                    current_user,
                    relation_name,
                    privilege_name
                )
                ORDER BY relation_name, privilege_name
            ) AS missing_table_privileges,

            ARRAY(
                SELECT
                    sequence_label || ':' || privilege_name
                FROM required_sequence_privileges
                WHERE
                    sequence_name IS NULL
                    OR NOT has_sequence_privilege(
                        current_user,
                        sequence_name,
                        privilege_name
                    )
                ORDER BY sequence_label, privilege_name
            ) AS missing_sequence_privileges,

            ARRAY(
                SELECT
                    schema_name || ':' || privilege_name
                FROM required_schema_privileges
                WHERE NOT has_schema_privilege(
                    current_user,
                    schema_name,
                    privilege_name
                )
                ORDER BY schema_name, privilege_name
            ) AS missing_schema_privileges,

            (
                SELECT COUNT(*)
                FROM required_table_privileges
            )::integer AS table_privileges_checked,

            (
                SELECT COUNT(*)
                FROM required_sequence_privileges
            )::integer AS sequence_privileges_checked,

            (
                SELECT COUNT(*)
                FROM required_schema_privileges
            )::integer AS schema_privileges_checked
    `)

  const state = result.rows[0]

  const missingPrivileges = [
    ...(state.missing_table_privileges ?? []),
    ...(state.missing_sequence_privileges ?? []),
    ...(state.missing_schema_privileges ?? []),
  ]

  if (missingPrivileges.length > 0) {
    throw new PerfSafetyError(`Missing seed privileges: ${missingPrivileges.join(', ')}`)
  }

  return {
    tablePrivilegesChecked: Number(state.table_privileges_checked),
    sequencePrivilegesChecked: Number(state.sequence_privileges_checked),
    schemaPrivilegesChecked: Number(state.schema_privileges_checked),
    missingPrivileges: 0,
  }
}
