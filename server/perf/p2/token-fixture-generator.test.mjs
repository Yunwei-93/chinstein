import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { TOTAL_USERS } from '../fixture-config.mjs'

import { TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'
import { assertBuiltApplicationSigner, generateTokenFixture } from './token-fixture-generator.mjs'

const DESTINATION = '/tmp/tokens.json'
const PRIVATE_TOKEN = 'offline-private-token-marker'
const PRIVATE_SECRET = 'offline-private-secret-marker'
const GENERATED_AT = 1_800_000_000

const EXPECTED_SUCCESS_ORDER = [
  'gate',
  'connect',
  'begin',
  'set-time-zone',
  'set-lock-timeout',
  'set-statement-timeout',
  'read-source',
  'commit',
  'close',
  'load-adapter',
  'build',
  'write',
]

const MAPPED_USERS = Object.freeze(
  Array.from({ length: TOTAL_USERS }, (_, index) =>
    Object.freeze({
      sequence: index + 1,
      userId: 10_001 + index,
    }),
  ),
)

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function createHarness(options = {}) {
  const failedStages = new Set(
    Array.isArray(options.failAt) ? options.failAt : options.failAt ? [options.failAt] : [],
  )

  const events = []

  const state = {
    transactionOpen: false,
    committed: false,
    rollbackAttempts: 0,
    closeAttempts: 0,
    closed: false,
    adapterLoads: 0,
    buildCalls: 0,
    writeCalls: 0,
  }

  function shouldFail(stage) {
    return failedStages.has(stage)
  }

  function privateFailure(stage) {
    return new Error(`${stage} failed with ${PRIVATE_SECRET} and ${PRIVATE_TOKEN}`)
  }

  const environment = {
    hostFingerprint: '777c6ca41572',
    database: 'neondb',
    current_date: '2026-09-18',
    wall_date: '2026-09-18',
    timezone: 'GMT',
    server_version: '18.6',
    in_recovery: false,
  }

  const defaultSourceResult = {
    source: {
      hostFingerprint: environment.hostFingerprint,
      database: environment.database,
      seedDate: '2026-09-18',
    },
    users: MAPPED_USERS,
    dailyCharacter: {
      id: 274,
      answer: 'known-answer',
    },
  }

  const sourceResult = hasOwn(options, 'sourceResult') ? options.sourceResult : defaultSourceResult

  function signTokenForUser(userId) {
    return `${PRIVATE_TOKEN}-${userId}`
  }

  function verifySignedToken() {
    return {
      header: {
        alg: 'HS256',
      },
      payload: {
        userId: 10_001,
        iat: GENERATED_AT,
        exp: GENERATED_AT + TOKEN_TTL_SECONDS,
      },
    }
  }

  const defaultAdapter = Object.freeze({
    signTokenForUser,
    verifySignedToken,
  })

  const adapter = hasOwn(options, 'adapter') ? options.adapter : defaultAdapter

  const defaultBuildResult = {
    fixture: {
      privateToken: PRIVATE_TOKEN,
    },
    summary: {
      users: TOTAL_USERS,
      pools: {
        R: 900,
        A: 7000,
        B: 200,
      },
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      tokenIssueSpreadSeconds: 0,
      remainingTokenSeconds: TOKEN_TTL_SECONDS,
      tokensReturned: false,
      loginPasswordStored: false,

      // Deliberately hostile fields prove that the generator
      // reconstructs its public result from an allowlist.
      token: PRIVATE_TOKEN,
      jwtSecret: PRIVATE_SECRET,
    },
  }

  const buildResult = hasOwn(options, 'buildResult') ? options.buildResult : defaultBuildResult

  const defaultWriteResult = {
    destination: DESTINATION,
    bytesWritten: 1_234_567,
    usersWritten: TOTAL_USERS,
    pools: {
      R: 900,
      A: 7000,
      B: 200,
    },
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    fileMode: '0600',
    atomicWrite: true,
    tokensReturned: false,

    // These fields must never be forwarded by the generator.
    token: PRIVATE_TOKEN,
    secret: PRIVATE_SECRET,
  }

  const writeResult = hasOwn(options, 'writeResult') ? options.writeResult : defaultWriteResult

  const client = {
    async query(text) {
      const sql = normalizeSql(text)

      if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') {
        events.push('begin')

        if (shouldFail('begin')) {
          throw privateFailure('begin')
        }

        state.transactionOpen = true

        return {
          rows: [],
        }
      }

      if (sql === "SET LOCAL TIME ZONE 'UTC'") {
        events.push('set-time-zone')

        assert.equal(state.transactionOpen, true)

        if (shouldFail('set-time-zone')) {
          throw privateFailure('set-time-zone')
        }

        return {
          rows: [],
        }
      }

      if (sql === 'SET LOCAL lock_timeout = 5000') {
        events.push('set-lock-timeout')

        assert.equal(state.transactionOpen, true)

        if (shouldFail('set-lock-timeout')) {
          throw privateFailure('set-lock-timeout')
        }

        return {
          rows: [],
        }
      }

      if (sql === 'SET LOCAL statement_timeout = 900000') {
        events.push('set-statement-timeout')

        assert.equal(state.transactionOpen, true)

        if (shouldFail('set-statement-timeout')) {
          throw privateFailure('set-statement-timeout')
        }

        return {
          rows: [],
        }
      }

      if (sql === 'COMMIT') {
        events.push('commit')

        assert.equal(state.transactionOpen, true)

        if (shouldFail('commit')) {
          throw privateFailure('commit')
        }

        state.transactionOpen = false
        state.committed = true

        return {
          rows: [],
        }
      }

      if (sql === 'ROLLBACK') {
        events.push('rollback')
        state.rollbackAttempts += 1

        if (shouldFail('rollback')) {
          throw privateFailure('rollback')
        }

        state.transactionOpen = false

        return {
          rows: [],
        }
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

  const dependencies = {
    async assertBuiltSigner() {
      events.push('gate')

      if (shouldFail('gate')) {
        throw privateFailure('gate')
      }

      return {
        compiledSignerReady: true,
      }
    },

    async connectToStaging() {
      events.push('connect')

      if (shouldFail('connect')) {
        throw privateFailure('connect')
      }

      return {
        client,
        identity: environment,
      }
    },

    async readTokenFixtureSource(receivedConnection) {
      events.push('read-source')

      assert.equal(state.transactionOpen, true)
      assert.equal(state.committed, false)
      assert.equal(state.closed, false)

      assert.equal(receivedConnection.client, client)
      assert.equal(receivedConnection.environment, environment)

      if (shouldFail('source')) {
        throw privateFailure('source')
      }

      return sourceResult
    },

    async loadJwtAdapter() {
      events.push('load-adapter')
      state.adapterLoads += 1

      assert.equal(state.transactionOpen, false)
      assert.equal(state.committed, true)
      assert.equal(state.closed, true)

      if (shouldFail('load-adapter')) {
        throw privateFailure('load-adapter')
      }

      return adapter
    },

    buildTokenFixture(input) {
      events.push('build')
      state.buildCalls += 1

      assert.equal(state.transactionOpen, false)
      assert.equal(state.committed, true)
      assert.equal(state.closed, true)

      assert.equal(input.source, sourceResult.source)
      assert.equal(input.users, sourceResult.users)
      assert.equal(input.dailyCharacter, sourceResult.dailyCharacter)
      assert.equal(input.signTokenForUser, adapter.signTokenForUser)
      assert.equal(input.verifySignedToken, adapter.verifySignedToken)
      assert.equal(typeof input.nowSeconds, 'function')

      if (shouldFail('build')) {
        throw privateFailure('build')
      }

      return buildResult
    },

    async writeTokenFixtureAtomically(receivedFixture, writeOptions) {
      events.push('write')
      state.writeCalls += 1

      assert.equal(state.transactionOpen, false)
      assert.equal(state.committed, true)
      assert.equal(state.closed, true)

      assert.equal(receivedFixture, buildResult.fixture)

      assert.deepEqual(writeOptions, {
        destination: DESTINATION,
      })

      if (shouldFail('write')) {
        throw privateFailure('write')
      }

      return writeResult
    },

    nowSeconds() {
      return GENERATED_AT
    },
  }

  return {
    events,
    state,
    environment,
    sourceResult,
    adapter,
    buildResult,
    writeResult,
    dependencies,
    privateValues: {
      token: PRIVATE_TOKEN,
      secret: PRIVATE_SECRET,
    },
  }
}

function runGenerator(harness, dependencies = harness.dependencies) {
  return generateTokenFixture(
    {
      destination: DESTINATION,
    },
    dependencies,
  )
}

function assertNoPrivateValues(value, harness) {
  const serialized = JSON.stringify(value)

  assert.equal(serialized.includes(harness.privateValues.token), false)
  assert.equal(serialized.includes(harness.privateValues.secret), false)
}

function assertSafeFailure(harness) {
  return (error) => {
    assert.equal(error instanceof Error, true)

    assertNoPrivateValues(
      {
        name: error.name,
        message: error.message,
        code: error.code ?? null,
      },
      harness,
    )

    return true
  }
}

test('runs the complete generator in the approved order', async () => {
  const harness = createHarness()

  const result = await runGenerator(harness)

  assert.deepEqual(harness.events, EXPECTED_SUCCESS_ORDER)

  assert.equal(harness.state.transactionOpen, false)
  assert.equal(harness.state.committed, true)
  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.closed, true)
  assert.equal(harness.state.adapterLoads, 1)
  assert.equal(harness.state.buildCalls, 1)
  assert.equal(harness.state.writeCalls, 1)

  assert.deepEqual(result, {
    check: 'p2-token-fixture-generation',
    compiledSignerReady: true,
    source: {
      hostFingerprint: '777c6ca41572',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    databaseRead: {
      isolation: 'repeatable read',
      readOnly: true,
      committed: true,
      connectionClosed: true,
    },
    artifact: {
      destination: DESTINATION,
      bytesWritten: 1_234_567,
      fileMode: '0600',
      atomicWrite: true,
    },
    usersWritten: TOTAL_USERS,
    pools: {
      R: 900,
      A: 7000,
      B: 200,
    },
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    tokenIssueSpreadSeconds: 0,
    remainingTokenSeconds: TOKEN_TTL_SECONDS,
    tokensReturned: false,
    secretsReturned: false,
  })
})

test('returns an allowlisted summary without fixture tokens or secrets', async () => {
  const harness = createHarness()

  const result = await runGenerator(harness)

  assertNoPrivateValues(result, harness)

  for (const forbiddenKey of [
    'fixture',
    'users',
    'token',
    'secret',
    'jwtSecret',
    'email',
    'answer',
  ]) {
    assert.equal(Object.hasOwn(result, forbiddenKey), false)
  }

  assert.equal(result.tokensReturned, false)
  assert.equal(result.secretsReturned, false)
})

test('rejects incomplete dependencies before running the build gate', async () => {
  const dependencyNames = [
    'assertBuiltSigner',
    'connectToStaging',
    'readTokenFixtureSource',
    'loadJwtAdapter',
    'buildTokenFixture',
    'writeTokenFixtureAtomically',
    'nowSeconds',
  ]

  for (const dependencyName of dependencyNames) {
    const harness = createHarness()

    const dependencies = {
      ...harness.dependencies,
      [dependencyName]: null,
    }

    await assert.rejects(runGenerator(harness, dependencies), /dependency .* is unavailable/)

    assert.deepEqual(harness.events, [])
    assert.equal(harness.state.closeAttempts, 0)
    assert.equal(harness.state.buildCalls, 0)
    assert.equal(harness.state.writeCalls, 0)
  }
})

test('stops before database access when the built-signer gate fails', async () => {
  const harness = createHarness({
    failAt: 'gate',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, ['gate'])
  assert.equal(harness.state.closeAttempts, 0)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('does not attempt cleanup when the staging connection never opened', async () => {
  const harness = createHarness({
    failAt: 'connect',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, ['gate', 'connect'])

  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.closeAttempts, 0)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('closes without rollback when BEGIN did not open a transaction', async () => {
  const harness = createHarness({
    failAt: 'begin',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, ['gate', 'connect', 'begin', 'close'])

  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('rolls back and closes when stable-read setup fails', async () => {
  const cases = [
    {
      failAt: 'set-time-zone',
      expectedEvents: ['gate', 'connect', 'begin', 'set-time-zone', 'rollback', 'close'],
    },
    {
      failAt: 'set-lock-timeout',
      expectedEvents: [
        'gate',
        'connect',
        'begin',
        'set-time-zone',
        'set-lock-timeout',
        'rollback',
        'close',
      ],
    },
    {
      failAt: 'set-statement-timeout',
      expectedEvents: [
        'gate',
        'connect',
        'begin',
        'set-time-zone',
        'set-lock-timeout',
        'set-statement-timeout',
        'rollback',
        'close',
      ],
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      failAt: testCase.failAt,
    })

    await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

    assert.deepEqual(harness.events, testCase.expectedEvents)

    assert.equal(harness.state.rollbackAttempts, 1)
    assert.equal(harness.state.closeAttempts, 1)
    assert.equal(harness.state.adapterLoads, 0)
    assert.equal(harness.state.buildCalls, 0)
    assert.equal(harness.state.writeCalls, 0)
  }
})

test('rolls back a source failure and never loads, builds, or writes', async () => {
  const harness = createHarness({
    failAt: 'source',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, [
    'gate',
    'connect',
    'begin',
    'set-time-zone',
    'set-lock-timeout',
    'set-statement-timeout',
    'read-source',
    'rollback',
    'close',
  ])

  assert.equal(harness.state.rollbackAttempts, 1)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('rejects malformed source results before commit', async () => {
  const validSource = {
    hostFingerprint: '777c6ca41572',
    database: 'neondb',
    seedDate: '2026-09-18',
  }

  const validCharacter = {
    id: 274,
    answer: 'known-answer',
  }

  const invalidSources = [
    null,
    {},
    {
      source: null,
      users: MAPPED_USERS,
      dailyCharacter: validCharacter,
    },
    {
      source: validSource,
      users: [],
      dailyCharacter: validCharacter,
    },
    {
      source: validSource,
      users: MAPPED_USERS,
      dailyCharacter: null,
    },
    {
      source: {
        ...validSource,
        database: 'production',
      },
      users: MAPPED_USERS,
      dailyCharacter: validCharacter,
    },
  ]

  for (const sourceResult of invalidSources) {
    const harness = createHarness({
      sourceResult,
    })

    await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

    assert.equal(harness.events.includes('commit'), false)
    assert.equal(harness.events.includes('rollback'), true)
    assert.equal(harness.state.adapterLoads, 0)
    assert.equal(harness.state.buildCalls, 0)
    assert.equal(harness.state.writeCalls, 0)
    assert.equal(harness.events.at(-1), 'close')
  }
})

test('does not continue when COMMIT cannot be confirmed', async () => {
  const harness = createHarness({
    failAt: 'commit',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, [
    'gate',
    'connect',
    'begin',
    'set-time-zone',
    'set-lock-timeout',
    'set-statement-timeout',
    'read-source',
    'commit',
    'rollback',
    'close',
  ])

  assert.equal(harness.state.committed, false)
  assert.equal(harness.state.rollbackAttempts, 1)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('still closes and never continues when rollback cannot be confirmed', async () => {
  const harness = createHarness({
    failAt: ['source', 'rollback'],
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, [
    'gate',
    'connect',
    'begin',
    'set-time-zone',
    'set-lock-timeout',
    'set-statement-timeout',
    'read-source',
    'rollback',
    'close',
  ])

  assert.equal(harness.state.rollbackAttempts, 1)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('does not load the JWT adapter when connection close fails', async () => {
  const harness = createHarness({
    failAt: 'close',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.deepEqual(harness.events, [
    'gate',
    'connect',
    'begin',
    'set-time-zone',
    'set-lock-timeout',
    'set-statement-timeout',
    'read-source',
    'commit',
    'close',
  ])

  assert.equal(harness.state.committed, true)
  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.closeAttempts, 1)
  assert.equal(harness.state.closed, false)
  assert.equal(harness.state.adapterLoads, 0)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
})

test('does not build or write when the JWT adapter cannot be loaded', async () => {
  const harness = createHarness({
    failAt: 'load-adapter',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.equal(harness.state.committed, true)
  assert.equal(harness.state.closed, true)
  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.adapterLoads, 1)
  assert.equal(harness.state.buildCalls, 0)
  assert.equal(harness.state.writeCalls, 0)
  assert.equal(harness.events.at(-1), 'load-adapter')
})

test('rejects an incomplete JWT adapter before fixture construction', async () => {
  const invalidAdapters = [
    null,
    {},
    {
      signTokenForUser() {},
    },
    {
      verifySignedToken() {},
    },
  ]

  for (const adapter of invalidAdapters) {
    const harness = createHarness({
      adapter,
    })

    await assert.rejects(runGenerator(harness), /JWT adapter is incomplete/)

    assert.equal(harness.state.committed, true)
    assert.equal(harness.state.closed, true)
    assert.equal(harness.state.rollbackAttempts, 0)
    assert.equal(harness.state.adapterLoads, 1)
    assert.equal(harness.state.buildCalls, 0)
    assert.equal(harness.state.writeCalls, 0)
  }
})

test('never writes when fixture construction fails', async () => {
  const harness = createHarness({
    failAt: 'build',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.equal(harness.state.committed, true)
  assert.equal(harness.state.closed, true)
  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.adapterLoads, 1)
  assert.equal(harness.state.buildCalls, 1)
  assert.equal(harness.state.writeCalls, 0)
  assert.equal(harness.events.at(-1), 'build')
})

test('rejects malformed builder results before file writing', async () => {
  const invalidBuildResults = [
    null,
    {},
    {
      fixture: null,
      summary: {},
    },
    {
      fixture: {},
      summary: null,
    },
    {
      fixture: {},
      summary: {
        users: TOTAL_USERS - 1,
      },
    },
  ]

  for (const buildResult of invalidBuildResults) {
    const harness = createHarness({
      buildResult,
    })

    await assert.rejects(runGenerator(harness), /fixture builder/)

    assert.equal(harness.state.committed, true)
    assert.equal(harness.state.closed, true)
    assert.equal(harness.state.rollbackAttempts, 0)
    assert.equal(harness.state.adapterLoads, 1)
    assert.equal(harness.state.buildCalls, 1)
    assert.equal(harness.state.writeCalls, 0)
  }
})

test('does not roll back the completed read transaction when writing fails', async () => {
  const harness = createHarness({
    failAt: 'write',
  })

  await assert.rejects(runGenerator(harness), assertSafeFailure(harness))

  assert.equal(harness.state.committed, true)
  assert.equal(harness.state.closed, true)
  assert.equal(harness.state.rollbackAttempts, 0)
  assert.equal(harness.state.adapterLoads, 1)
  assert.equal(harness.state.buildCalls, 1)
  assert.equal(harness.state.writeCalls, 1)
  assert.equal(harness.events.at(-1), 'write')
})

test('rejects an invalid writer summary after the write attempt', async () => {
  const invalidWriteResults = [
    null,
    {},
    {
      destination: '/tmp/wrong.json',
    },
    {
      destination: DESTINATION,
      bytesWritten: 0,
      usersWritten: TOTAL_USERS,
      pools: {
        R: 900,
        A: 7000,
        B: 200,
      },
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      fileMode: '0600',
      atomicWrite: true,
      tokensReturned: false,
    },
  ]

  for (const writeResult of invalidWriteResults) {
    const harness = createHarness({
      writeResult,
    })

    await assert.rejects(runGenerator(harness), /fixture writer summary/)

    assert.equal(harness.state.committed, true)
    assert.equal(harness.state.closed, true)
    assert.equal(harness.state.rollbackAttempts, 0)
    assert.equal(harness.state.buildCalls, 1)
    assert.equal(harness.state.writeCalls, 1)
  }
})

test('rejects every fixture destination except /tmp/tokens.json', async () => {
  const harness = createHarness()

  await assert.rejects(
    generateTokenFixture(
      {
        destination: '/tmp/not-tokens.json',
      },
      harness.dependencies,
    ),
    /fixture destination must be \/tmp\/tokens\.json/,
  )

  assert.deepEqual(harness.events, [])
})

function createRegularFileMetadata(mtimeMs, regular = true) {
  return {
    mtimeMs,

    isFile() {
      return regular
    },
  }
}

function createBuildGateFileSystem({
  sourceTime = 20,
  buildTime = 30,
  configTime = 10,
  sourceRegular = true,
  buildRegular = true,
  configRegular = true,
  buildSource = `
    import jwt from 'jsonwebtoken'

    export function signToken(userId) {
      return jwt.sign({ userId }, 'offline-only')
    }
  `,
  lstatFailure = false,
} = {}) {
  return {
    async lstat(resource) {
      if (lstatFailure) {
        throw new Error(`lstat failed with ${PRIVATE_SECRET}`)
      }

      const path = resource.pathname

      if (path.endsWith('/src/auth.ts')) {
        return createRegularFileMetadata(sourceTime, sourceRegular)
      }

      if (path.endsWith('/dist/auth.js')) {
        return createRegularFileMetadata(buildTime, buildRegular)
      }

      if (path.endsWith('/tsconfig.json')) {
        return createRegularFileMetadata(configTime, configRegular)
      }

      throw new Error(`Unexpected file: ${path}`)
    },

    async readFile(resource, encoding) {
      assert.equal(resource.pathname.endsWith('/dist/auth.js'), true)
      assert.equal(encoding, 'utf8')

      return buildSource
    },
  }
}

test('accepts a fresh regular compiled application signer', async () => {
  const fileSystem = createBuildGateFileSystem()

  const result = await assertBuiltApplicationSigner(fileSystem)

  assert.deepEqual(result, {
    compiledSignerReady: true,
  })
})

test('rejects incomplete compiled-signer gate dependencies', async () => {
  await assert.rejects(
    assertBuiltApplicationSigner({
      lstat: null,
      readFile: async () => '',
    }),
    /compiled-signer gate dependencies are incomplete/,
  )

  await assert.rejects(
    assertBuiltApplicationSigner({
      lstat: async () => createRegularFileMetadata(1),
      readFile: null,
    }),
    /compiled-signer gate dependencies are incomplete/,
  )
})

test('rejects unavailable and non-regular compiled signer files', async () => {
  await assert.rejects(
    assertBuiltApplicationSigner(
      createBuildGateFileSystem({
        lstatFailure: true,
      }),
    ),
    /compiled signer is unavailable/,
  )

  const nonRegularCases = [
    {
      sourceRegular: false,
    },
    {
      buildRegular: false,
    },
    {
      configRegular: false,
    },
  ]

  for (const testCase of nonRegularCases) {
    await assert.rejects(
      assertBuiltApplicationSigner(createBuildGateFileSystem(testCase)),
      /compiled signer inputs must be regular files/,
    )
  }
})

test('rejects stale or structurally unexpected compiled signer output', async () => {
  const cases = [
    {
      fileSystem: createBuildGateFileSystem({
        sourceTime: 40,
        buildTime: 30,
      }),
      expectedError: /compiled signer is stale/,
    },
    {
      fileSystem: createBuildGateFileSystem({
        buildSource: `
          export function anotherFunction() {
            return true
          }
        `,
      }),
      expectedError: /compiled signer export is unavailable/,
    },
    {
      fileSystem: createBuildGateFileSystem({
        buildSource: `
          import helper from './helper.js'

          export function signToken(userId) {
            return helper(userId)
          }
        `,
      }),
      expectedError: /compiled signer has an unapproved relative dependency/,
    },
  ]

  for (const testCase of cases) {
    await assert.rejects(assertBuiltApplicationSigner(testCase.fileSystem), testCase.expectedError)
  }
})

test('loads the JWT adapter dynamically instead of importing it before the safety gates', async () => {
  const generatorSource = await readFile(
    new URL('./token-fixture-generator.mjs', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(generatorSource, /from\s+['"]\.\/token-fixture-jwt-adapter\.mjs['"]/)

  assert.match(
    generatorSource,
    /await\s+import\(\s*['"]\.\/token-fixture-jwt-adapter\.mjs['"]\s*\)/,
  )
})
