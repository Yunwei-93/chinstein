import { createHash } from 'node:crypto'

import pg from 'pg'

import { PerfSafetyError } from '../staging-guard.mjs'

const { Client } = pg

const EXPECTED_HOST_FINGERPRINT = '777c6ca41572'
const EXPECTED_DATABASE = 'neondb'
const APPROVED_TIMEZONES = new Set(['GMT', 'UTC', 'Etc/UTC'])
const APPROVED_SSL_MODES = new Set(['require', 'verify-full'])

function fail(message, code = null) {
  throw new PerfSafetyError(message, code)
}

function createDefaultClient(configuration) {
  return new Client(configuration)
}

function fingerprintHostname(hostname) {
  return createHash('sha256').update(hostname).digest('hex').slice(0, 12)
}

function validateDependencies({ createClient, fingerprintHostname: createFingerprint }) {
  if (typeof createClient !== 'function' || typeof createFingerprint !== 'function') {
    fail('Runtime staging connector dependencies are incomplete')
  }
}

function readRuntimeConnection(environment) {
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    fail('Runtime staging environment is unavailable')
  }

  const connectionString = environment.DATABASE_URL

  if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
    fail('Runtime staging DATABASE_URL is missing')
  }

  let url
  let database
  let user
  let password

  try {
    url = new URL(connectionString)
    database = decodeURIComponent(url.pathname.slice(1))
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
  } catch {
    fail('Runtime staging DATABASE_URL is invalid')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('Runtime staging connection protocol is not PostgreSQL')
  }

  if (user.length === 0 || password.length === 0) {
    fail('Runtime staging database credentials are missing')
  }

  const sslMode = url.searchParams.get('sslmode')

  if (sslMode !== null && !APPROVED_SSL_MODES.has(sslMode)) {
    fail('Runtime staging SSL mode is not approved')
  }

  return {
    url,
    database,
    user,
    password,
    port: url.port === '' ? 5432 : Number(url.port),
  }
}

function validateRuntimeTarget({ url, database, createFingerprint }) {
  let hostFingerprint

  try {
    hostFingerprint = createFingerprint(url.hostname)
  } catch {
    fail('Runtime staging host fingerprint could not be verified')
  }

  if (hostFingerprint !== EXPECTED_HOST_FINGERPRINT) {
    fail('Runtime staging host fingerprint is not approved')
  }

  if (database !== EXPECTED_DATABASE) {
    fail('Runtime database name differs from the approved staging database')
  }

  if (!url.hostname.includes('-pooler')) {
    fail('Runtime connection is not the approved pooled staging endpoint')
  }

  return hostFingerprint
}

function validateClient(client) {
  if (
    !client ||
    typeof client.connect !== 'function' ||
    typeof client.query !== 'function' ||
    typeof client.end !== 'function'
  ) {
    fail('Runtime staging client is incomplete')
  }
}

function validateIdentity(identity) {
  if (!identity || identity.database !== EXPECTED_DATABASE) {
    fail('Connected database failed the runtime identity check')
  }

  if (!APPROVED_TIMEZONES.has(identity.timezone)) {
    fail('Runtime database session does not use a zero-offset timezone')
  }

  if (identity.in_recovery !== false) {
    fail('Runtime staging database recovery state is not approved')
  }
}

async function cleanFailedConnection(client, transactionOpen) {
  if (!client) {
    return {
      rollbackConfirmed: !transactionOpen,
      closeConfirmed: true,
    }
  }

  let rollbackConfirmed = !transactionOpen
  let closeConfirmed = false

  if (transactionOpen) {
    try {
      await client.query('ROLLBACK')
      rollbackConfirmed = true
    } catch {}
  }

  try {
    await client.end()
    closeConfirmed = true
  } catch {}

  return {
    rollbackConfirmed,
    closeConfirmed,
  }
}

export async function connectToP2StagingRuntime(
  { environment = process.env } = {},
  {
    createClient = createDefaultClient,
    fingerprintHostname: createFingerprint = fingerprintHostname,
  } = {},
) {
  validateDependencies({
    createClient,
    fingerprintHostname: createFingerprint,
  })

  const { url, database, user, password, port } = readRuntimeConnection(environment)

  const hostFingerprint = validateRuntimeTarget({
    url,
    database,
    createFingerprint,
  })

  let client = null
  let transactionOpen = false

  try {
    const candidateClient = createClient({
      host: url.hostname,
      port,
      user,
      password,
      database,
      ssl: {
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 10_000,
    })

    validateClient(candidateClient)
    client = candidateClient
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

    validateIdentity(identity)

    await client.query('COMMIT')
    transactionOpen = false

    return {
      client,
      identity: {
        hostFingerprint,
        database: identity.database,
        current_date: identity.current_date,
        wall_date: identity.wall_date,
        timezone: identity.timezone,
        server_version: identity.server_version,
        in_recovery: identity.in_recovery,
      },
    }
  } catch (error) {
    const cleanup = await cleanFailedConnection(client, transactionOpen)

    if (!cleanup.rollbackConfirmed || !cleanup.closeConfirmed) {
      throw new PerfSafetyError(
        'Runtime staging cleanup could not be confirmed',
        typeof error?.code === 'string' ? error.code : null,
      )
    }

    if (error instanceof PerfSafetyError) {
      throw error
    }

    throw new PerfSafetyError(
      'Runtime staging connection or identity check failed; raw error suppressed',
      typeof error?.code === 'string' ? error.code : null,
    )
  }
}
