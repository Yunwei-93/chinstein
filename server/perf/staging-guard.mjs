import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import dotenv from 'dotenv'
import pg from 'pg'

const { Client } = pg

const ENV_FILE = new URL('../.env.staging', import.meta.url)
const EXPECTED_HOST_FINGERPRINT = '777c6ca41572'
const EXPECTED_DATABASE = 'neondb'

export class PerfSafetyError extends Error {
  constructor(message, code = null) {
    super(message)
    this.name = 'PerfSafetyError'
    this.code = code
  }
}

export function safeError(error, stage) {
  return {
    stage,
    error:
      error instanceof PerfSafetyError
        ? error.message
        : 'Operation failed; raw error suppressed to protect credentials',
    code: typeof error?.code === 'string' ? error.code : null,
  }
}

export async function connectToStaging() {
  let connectionString

  try {
    const env = dotenv.parse(readFileSync(ENV_FILE))
    connectionString = env.DATABASE_URL
  } catch {
    throw new PerfSafetyError('Cannot read the explicit staging environment file')
  }

  if (!connectionString) {
    throw new PerfSafetyError('Staging DATABASE_URL is missing')
  }

  let url
  let database

  try {
    url = new URL(connectionString)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    throw new PerfSafetyError('Staging DATABASE_URL is invalid')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new PerfSafetyError('Connection protocol is not PostgreSQL')
  }

  const hostFingerprint = createHash('sha256').update(url.hostname).digest('hex').slice(0, 12)

  if (hostFingerprint !== EXPECTED_HOST_FINGERPRINT) {
    throw new PerfSafetyError('Staging host fingerprint changed; refusing to connect')
  }

  if (database !== EXPECTED_DATABASE) {
    throw new PerfSafetyError('Database name differs from the verified staging database')
  }

  if (!url.hostname.includes('-pooler')) {
    throw new PerfSafetyError('Connection is not the verified pooled staging endpoint')
  }

  let client
  let transactionOpen = false

  try {
    client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 10000,
    })

    await client.connect()
    await client.query('BEGIN READ ONLY')
    transactionOpen = true

    await client.query('SET LOCAL statement_timeout = 15000')

    const { rows } = await client.query(`
      SELECT
        current_database() AS database,
        CURRENT_DATE::text AS current_date,
        clock_timestamp()::date::text AS wall_date,
        current_setting('TimeZone') AS timezone,
        current_setting('server_version') AS server_version,
        pg_is_in_recovery() AS in_recovery
    `)

    const identity = rows[0]

    if (identity.database !== EXPECTED_DATABASE) {
      throw new PerfSafetyError('Connected database failed the identity check')
    }

    if (!['GMT', 'UTC', 'Etc/UTC'].includes(identity.timezone)) {
      throw new PerfSafetyError(
        'Database session timezone is not a recognized zero-offset timezone',
      )
    }

    if (identity.in_recovery) {
      throw new PerfSafetyError('Connected database is a recovery replica')
    }

    await client.query('COMMIT')
    transactionOpen = false

    return {
      client,
      identity: {
        hostFingerprint,
        ...identity,
      },
    }
  } catch (error) {
    if (client) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK')
        } catch {}
      }

      try {
        await client.end()
      } catch {}
    }

    if (error instanceof PerfSafetyError) {
      throw error
    }

    throw new PerfSafetyError(
      'Staging connection or identity check failed; raw error suppressed',
      typeof error?.code === 'string' ? error.code : null,
    )
  }
}
