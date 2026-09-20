import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { connectToP2StagingRuntime } from './runtime-staging-connector.mjs'

const APPROVED_FINGERPRINT = '777c6ca41572'
const PRIVATE_USER = 'runtime-user-marker'
const PRIVATE_PASSWORD = 'runtime-password-marker'
const PRIVATE_HOST = 'approved-pooler.us-east-2.aws.neon.tech'
const PRIVATE_DATABASE_URL =
  `postgresql://${PRIVATE_USER}:${PRIVATE_PASSWORD}` + `@${PRIVATE_HOST}/neondb?sslmode=verify-full`

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function assertSecretFreeError(error, expectedPattern) {
  assert.match(error.message, expectedPattern)

  const exposedText = [error.message, error.stack ?? '', String(error.code ?? '')].join('\n')

  for (const privateValue of [PRIVATE_DATABASE_URL, PRIVATE_USER, PRIVATE_PASSWORD, PRIVATE_HOST]) {
    assert.equal(exposedText.includes(privateValue), false)
  }

  return true
}

function createHarness(options = {}) {
  const failures = new Set(
    Array.isArray(options.failAt) ? options.failAt : options.failAt ? [options.failAt] : [],
  )

  const environment = Object.hasOwn(options, 'environment')
    ? options.environment
    : {
        DATABASE_URL: options.databaseUrl ?? PRIVATE_DATABASE_URL,
      }

  const identity = {
    database: 'neondb',
    current_date: '2026-09-18',
    wall_date: '2026-09-18',
    timezone: 'GMT',
    server_version: '18.6',
    in_recovery: false,
    ...(options.identity ?? {}),
  }

  const events = []
  const configurations = []
  const fingerprintInputs = []

  const state = {
    factoryCalls: 0,
    transactionOpen: false,
    rollbackAttempts: 0,
    closeAttempts: 0,
    closed: false,
  }

  function shouldFail(stage) {
    return failures.has(stage)
  }

  function privateFailure(stage) {
    const error = new Error(`${stage} failed for ${PRIVATE_DATABASE_URL}`)

    error.code = 'XX000'
    return error
  }

  const client = {
    async connect() {
      events.push('connect')

      if (shouldFail('connect')) {
        throw privateFailure('connect')
      }
    },

    async query(text) {
      const sql = normalizeSql(text)

      if (sql === 'BEGIN READ ONLY') {
        events.push('begin')

        if (shouldFail('begin')) {
          throw privateFailure('begin')
        }

        state.transactionOpen = true
        return { rows: [] }
      }

      if (sql === 'SET LOCAL statement_timeout = 15000') {
        events.push('set-timeout')

        if (shouldFail('set-timeout')) {
          throw privateFailure('set-timeout')
        }

        return { rows: [] }
      }

      if (sql.includes('current_database() AS database')) {
        events.push('identity')

        if (shouldFail('identity')) {
          throw privateFailure('identity')
        }

        return {
          rows: [identity],
        }
      }

      if (sql === 'COMMIT') {
        events.push('commit')

        if (shouldFail('commit')) {
          throw privateFailure('commit')
        }

        state.transactionOpen = false
        return { rows: [] }
      }

      if (sql === 'ROLLBACK') {
        events.push('rollback')
        state.rollbackAttempts += 1

        if (shouldFail('rollback')) {
          throw privateFailure('rollback')
        }

        state.transactionOpen = false
        return { rows: [] }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    },

    async end() {
      events.push('close')
      state.closeAttempts += 1

      if (shouldFail('close')) {
        throw privateFailure('close')
      }

      state.closed = true
    },
  }

  function createClient(configuration) {
    events.push('create-client')
    state.factoryCalls += 1
    configurations.push(configuration)
    return client
  }

  function fingerprintHostname(hostname) {
    events.push('fingerprint')
    fingerprintInputs.push(hostname)

    return options.fingerprint ?? APPROVED_FINGERPRINT
  }

  async function connect() {
    return connectToP2StagingRuntime(
      {
        environment,
      },
      {
        createClient,
        fingerprintHostname,
      },
    )
  }

  return {
    client,
    configurations,
    connect,
    events,
    fingerprintInputs,
    state,
  }
}

test('connects only to the approved runtime staging identity', async () => {
  const harness = createHarness()

  const connection = await harness.connect()

  assert.equal(connection.client, harness.client)

  assert.deepEqual(connection.identity, {
    hostFingerprint: APPROVED_FINGERPRINT,
    database: 'neondb',
    current_date: '2026-09-18',
    wall_date: '2026-09-18',
    timezone: 'GMT',
    server_version: '18.6',
    in_recovery: false,
  })

  assert.deepEqual(harness.events, [
    'fingerprint',
    'create-client',
    'connect',
    'begin',
    'set-timeout',
    'identity',
    'commit',
  ])

  assert.deepEqual(harness.fingerprintInputs, [PRIVATE_HOST])

  assert.deepEqual(harness.configurations, [
    {
      host: PRIVATE_HOST,
      port: 5432,
      user: PRIVATE_USER,
      password: PRIVATE_PASSWORD,
      database: 'neondb',
      ssl: {
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 10_000,
    },
  ])

  assert.equal(harness.state.transactionOpen, false)
  assert.equal(harness.state.closeAttempts, 0)

  const serializedIdentity = JSON.stringify(connection.identity)

  assert.equal(serializedIdentity.includes(PRIVATE_PASSWORD), false)
  assert.equal(serializedIdentity.includes(PRIVATE_HOST), false)
})

test('rejects invalid runtime URLs before creating a client', async () => {
  const cases = [
    {
      environment: {},
      expected: /DATABASE_URL is missing/,
    },
    {
      environment: {
        DATABASE_URL: '   ',
      },
      expected: /DATABASE_URL is missing/,
    },
    {
      environment: {
        DATABASE_URL: 'not-a-url',
      },
      expected: /DATABASE_URL is invalid/,
    },
    {
      environment: {
        DATABASE_URL: 'https://example.invalid/neondb',
      },
      expected: /protocol is not PostgreSQL/,
    },
    {
      environment: {
        DATABASE_URL:
          `postgresql://${PRIVATE_USER}:${PRIVATE_PASSWORD}` +
          `@${PRIVATE_HOST}/neondb?sslmode=disable`,
      },
      expected: /SSL mode is not approved/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      environment: testCase.environment,
    })

    await assert.rejects(harness.connect(), (error) =>
      assertSecretFreeError(error, testCase.expected),
    )

    assert.equal(harness.state.factoryCalls, 0)
  }
})

test('rejects unapproved database targets before creating a client', async () => {
  const cases = [
    {
      options: {
        fingerprint: '032a14edbcd2',
      },
      expected: /fingerprint is not approved/,
    },
    {
      options: {
        databaseUrl:
          `postgresql://${PRIVATE_USER}:${PRIVATE_PASSWORD}` + `@${PRIVATE_HOST}/production`,
      },
      expected: /database name differs/,
    },
    {
      options: {
        databaseUrl:
          `postgresql://${PRIVATE_USER}:${PRIVATE_PASSWORD}` +
          '@approved.us-east-2.aws.neon.tech/neondb',
      },
      expected: /pooled staging endpoint/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness(testCase.options)

    await assert.rejects(harness.connect(), (error) =>
      assertSecretFreeError(error, testCase.expected),
    )

    assert.equal(harness.state.factoryCalls, 0)
  }
})

test('rejects invalid connected database identities', async () => {
  const cases = [
    {
      identity: {
        database: 'production',
      },
      expected: /runtime identity check/,
    },
    {
      identity: {
        timezone: 'America/New_York',
      },
      expected: /zero-offset timezone/,
    },
    {
      identity: {
        in_recovery: true,
      },
      expected: /recovery state is not approved/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      identity: testCase.identity,
    })

    await assert.rejects(harness.connect(), (error) =>
      assertSecretFreeError(error, testCase.expected),
    )

    assert.equal(harness.state.rollbackAttempts, 1)
    assert.equal(harness.state.closeAttempts, 1)
    assert.equal(harness.state.closed, true)
  }
})

test('sanitizes connection failures and closes the client', async () => {
  const harness = createHarness({
    failAt: 'connect',
  })

  await assert.rejects(harness.connect(), (error) =>
    assertSecretFreeError(error, /connection or identity check failed/),
  )

  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.closed, true)
})

test('fails closed when cleanup cannot be confirmed', async () => {
  const harness = createHarness({
    failAt: ['identity', 'rollback', 'close'],
  })

  await assert.rejects(harness.connect(), (error) =>
    assertSecretFreeError(error, /cleanup could not be confirmed/),
  )

  assert.equal(harness.state.rollbackAttempts, 1)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.closed, false)
})

test('rejects an incomplete client before network access', async () => {
  await assert.rejects(
    connectToP2StagingRuntime(
      {
        environment: {
          DATABASE_URL: PRIVATE_DATABASE_URL,
        },
      },
      {
        createClient() {
          return {}
        },
        fingerprintHostname() {
          return APPROVED_FINGERPRINT
        },
      },
    ),
    /Runtime staging client is incomplete/,
  )
})

test('runtime connector never reads the local staging env file', async () => {
  const [connectorSource, generatorSource] = await Promise.all([
    readFile(new URL('./runtime-staging-connector.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./token-fixture-generator.mjs', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(connectorSource, /\.env\.staging|readFileSync|dotenv/)

  assert.match(generatorSource, /from\s+['"]\.\/runtime-staging-connector\.mjs['"]/)

  assert.match(generatorSource, /connectToStaging:\s*connectToP2StagingRuntime/)

  assert.doesNotMatch(generatorSource, /connectToStaging\s*,\s*PerfSafetyError/)
})
