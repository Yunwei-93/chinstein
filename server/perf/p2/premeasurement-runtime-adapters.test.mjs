import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants as fileSystemConstants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { TOTAL_USERS } from '../fixture-config.mjs'
import { runP2Premeasurement } from './premeasurement-runner.mjs'
import {
  DESIGNATED_LOGIN_SEQUENCE,
  TOKEN_FIXTURE_SCHEMA_VERSION,
  TOKEN_TTL_SECONDS,
  poolForSequence,
} from './token-fixture-contracts.mjs'
import * as runtimeAdapterModule from './premeasurement-runtime-adapters.mjs'

const { createP2PremeasurementRuntimeDependencies } = runtimeAdapterModule

const BASE_URL = 'https://staging.example.invalid'
const NOW_SECONDS = Math.floor(Date.parse('2026-09-18T12:00:00.000Z') / 1000)
const CURRENT_DATE = '2026-09-18'
const DATABASE = 'neondb'
const DATABASE_HOST_FINGERPRINT = '777c6ca41572'
const EFFECTIVE_USER_ID = 501
const PRIVATE_PASSWORD = 'private-login-password-value-000001'
const PRIVATE_EMAIL = 'player_00001@example.invalid'
const PRIVATE_ANSWER = 'private-daily-answer'
const PRIVATE_DATABASE_URL = 'postgresql:' + '//private:private@private.invalid/neondb'
const PRIVATE_RAW_ERROR = `${PRIVATE_PASSWORD}:${PRIVATE_DATABASE_URL}:${PRIVATE_EMAIL}`
const IMAGE_DIGEST = `sha256:${'a'.repeat(64)}`
const GIT_COMMIT = 'b'.repeat(40)

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function buildFixture() {
  const issuedAt = NOW_SECONDS - 120

  return {
    schemaVersion: TOKEN_FIXTURE_SCHEMA_VERSION,
    generatedAt: NOW_SECONDS - 60,
    source: {
      hostFingerprint: DATABASE_HOST_FINGERPRINT,
      database: DATABASE,
      seedDate: CURRENT_DATE,
    },
    dailyCharacter: {
      id: 274,
      answer: PRIVATE_ANSWER,
    },
    login: {
      sequence: DESIGNATED_LOGIN_SEQUENCE,
      email: PRIVATE_EMAIL,
    },
    users: Array.from({ length: TOTAL_USERS }, (_, index) => {
      const sequence = index + 1

      return {
        sequence,
        userId: 10_000 + sequence,
        pool: poolForSequence(sequence),
        token: `private-fixture-token-${sequence}`,
        issuedAt,
        expiresAt: issuedAt + TOKEN_TTL_SECONDS,
      }
    }),
  }
}

const FIXTURE = buildFixture()
const SERIALIZED_FIXTURE = `${JSON.stringify(FIXTURE)}\n`

function createDeploymentEvidence() {
  return {
    stage: 'aws-staging',
    region: 'us-east-2',
    service: 'chinstein-api-staging',
    originFingerprint: fingerprint(BASE_URL),
    taskDefinitionRevision: 42,
    imageDigest: IMAGE_DIGEST,
    gitCommit: GIT_COMMIT,
    deploymentStatus: 'COMPLETED',
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
  }
}

function createDatabaseIdentity() {
  return {
    hostFingerprint: DATABASE_HOST_FINGERPRINT,
    database: DATABASE,
    current_date: CURRENT_DATE,
    wall_date: CURRENT_DATE,
    timezone: 'UTC',
    server_version: '18.6',
    in_recovery: false,
  }
}

function jsonResponse(body, status = 200) {
  const serialized = JSON.stringify(body)

  return new Response(serialized, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(serialized, 'utf8')),
    },
  })
}

function createHarness({
  serializedFixture = SERIALIZED_FIXTURE,
  fileMetadata = {},
  openError = null,
  readError = null,
  closeFixtureError = null,
  connectError = null,
  closeDatabaseError = null,
  identity = createDatabaseIdentity(),
  observeError = null,
  fetchImpl = null,
  clock = () => NOW_SECONDS,
} = {}) {
  const events = []
  const fixtureOpenCalls = []
  let fixtureCloseCalls = 0
  let databaseCloseCalls = 0

  const openTokenFixture = async (path, flags) => {
    events.push('open-fixture')
    fixtureOpenCalls.push({ path, flags })

    if (openError) {
      throw openError
    }

    return {
      async stat() {
        events.push('stat-fixture')

        return {
          isFile: () => true,
          mode: 0o100600,
          uid: EFFECTIVE_USER_ID,
          size: Buffer.byteLength(serializedFixture, 'utf8'),
          ...fileMetadata,
        }
      },

      async readFile(encoding) {
        events.push('read-fixture')
        assert.equal(encoding, 'utf8')

        if (readError) {
          throw readError
        }

        return serializedFixture
      },

      async close() {
        events.push('close-fixture')
        fixtureCloseCalls += 1

        if (closeFixtureError) {
          throw closeFixtureError
        }
      },
    }
  }

  const connectToStaging = async ({ environment }) => {
    events.push('connect-database')
    assert.equal(environment.DATABASE_URL, PRIVATE_DATABASE_URL)

    if (connectError) {
      throw connectError
    }

    return {
      client: {
        async end() {
          events.push('close-database')
          databaseCloseCalls += 1

          if (closeDatabaseError) {
            throw closeDatabaseError
          }
        },
      },
      identity,
    }
  }

  const environment = {
    DATABASE_URL: PRIVATE_DATABASE_URL,
    PERF_LOGIN_PASSWORD: PRIVATE_PASSWORD,
  }

  const observeDeployment = async () => {
    events.push('observe-deployment')

    if (observeError) {
      throw observeError
    }

    return createDeploymentEvidence()
  }

  const effectiveFetch =
    fetchImpl ??
    (async (url) => {
      events.push(`http:${new URL(url).pathname}`)

      if (url.endsWith('/api/health')) {
        return jsonResponse({
          status: 'ok',
          time: `${CURRENT_DATE}T12:00:00.000Z`,
        })
      }

      if (url.endsWith('/api/auth/login')) {
        return jsonResponse({
          token: 'private-login-response-token',
          user: {
            id: FIXTURE.users[0].userId,
            name: 'private-name',
          },
        })
      }

      return jsonResponse({
        id: FIXTURE.users[0].userId,
        name: 'private-name',
        points: 0,
        streak: 0,
        badges: [],
        learnedCharacterIds: [],
        completedToday: false,
      })
    })

  const dependencies = createP2PremeasurementRuntimeDependencies(
    {
      environment,
      observeDeployment,
    },
    {
      openTokenFixture,
      connectToStaging,
      fetchImpl: effectiveFetch,
      nowSeconds: () => {
        events.push('clock')
        return clock()
      },
      readEffectiveUserId: () => EFFECTIVE_USER_ID,
    },
  )

  return {
    dependencies,
    environment,
    events,
    fixtureOpenCalls,
    get fixtureCloseCalls() {
      return fixtureCloseCalls
    },
    get databaseCloseCalls() {
      return databaseCloseCalls
    },
  }
}

async function captureFailure(operation) {
  try {
    await operation()
  } catch (error) {
    return error
  }

  assert.fail('Expected the operation to fail')
}

test('exports only the runtime dependency factory and returns the exact runner surface', () => {
  assert.deepEqual(Object.keys(runtimeAdapterModule), ['createP2PremeasurementRuntimeDependencies'])

  const harness = createHarness()

  assert.deepEqual(Object.keys(harness.dependencies).sort(), [
    'executeCanary',
    'loadFixtureEvidence',
    'nowSeconds',
    'observeDeployment',
    'readDatabaseEvidence',
    'readLoginPassword',
  ])
  assert.equal(Object.isFrozen(harness.dependencies), true)
  assert.deepEqual(harness.events, [])
})

test('loads only the private owner-controlled token fixture and selects Pool R sequence one', async () => {
  const harness = createHarness()
  const evidence = await harness.dependencies.loadFixtureEvidence()

  assert.equal(harness.fixtureOpenCalls.length, 1)
  assert.equal(harness.fixtureOpenCalls[0].path, '/tmp/tokens.json')
  assert.notEqual(harness.fixtureOpenCalls[0].flags & fileSystemConstants.O_NOFOLLOW, 0)
  assert.equal(harness.fixtureCloseCalls, 1)

  assert.equal(evidence.fixtureMetadata.users, 8100)
  assert.equal(evidence.fixtureMetadata.source.seedDate, CURRENT_DATE)
  assert.equal(evidence.designatedUser.sequence, 1)
  assert.equal(evidence.designatedUser.pool, 'R')
  assert.equal(evidence.designatedUser.userId, FIXTURE.users[0].userId)
  assert.equal(evidence.designatedUser.token, FIXTURE.users[0].token)
})

test('rejects unsafe fixture metadata and still closes the opened file', async () => {
  const cases = [
    {
      mode: 0o100644,
    },
    {
      uid: EFFECTIVE_USER_ID + 1,
    },
    {
      size: 0,
    },
    {
      size: 16 * 1024 * 1024 + 1,
    },
    {
      isFile: () => false,
    },
  ]

  for (const fileMetadata of cases) {
    const harness = createHarness({ fileMetadata })
    const error = await captureFailure(() => harness.dependencies.loadFixtureEvidence())

    assert.equal(error.message, 'PERF-P2 runtime adapter failed at token-fixture-read')
    assert.equal(harness.fixtureCloseCalls, 1)
  }
})

test('suppresses fixture read and validation errors and confirms file closure', async () => {
  const readFailure = createHarness({
    readError: new Error(PRIVATE_RAW_ERROR),
  })
  const readError = await captureFailure(() => readFailure.dependencies.loadFixtureEvidence())

  assert.equal(readError.message, 'PERF-P2 runtime adapter failed at token-fixture-read')
  assert.equal(readError.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(readFailure.fixtureCloseCalls, 1)

  const invalidFixture = createHarness({
    serializedFixture: `{"private":"${PRIVATE_RAW_ERROR}"}\n`,
  })
  const validationError = await captureFailure(() =>
    invalidFixture.dependencies.loadFixtureEvidence(),
  )

  assert.equal(
    validationError.message,
    'PERF-P2 runtime adapter failed at token-fixture-validation',
  )
  assert.equal(validationError.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(invalidFixture.fixtureCloseCalls, 1)
})

test('fails closed when fixture closure cannot be confirmed', async () => {
  const harness = createHarness({
    closeFixtureError: new Error(PRIVATE_RAW_ERROR),
  })

  const error = await captureFailure(() => harness.dependencies.loadFixtureEvidence())

  assert.equal(error.message, 'PERF-P2 runtime adapter failed at token-fixture-close')
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(harness.fixtureCloseCalls, 1)
})

test('closes an opened fixture handle when its interface is incomplete', async () => {
  let closeCalls = 0

  const dependencies = createP2PremeasurementRuntimeDependencies(
    {
      environment: {
        DATABASE_URL: PRIVATE_DATABASE_URL,
        PERF_LOGIN_PASSWORD: PRIVATE_PASSWORD,
      },
      observeDeployment: async () => createDeploymentEvidence(),
    },
    {
      openTokenFixture: async () => ({
        async close() {
          closeCalls += 1
        },
      }),
      connectToStaging: async () => {
        throw new Error('not used')
      },
      createHttpAdapter: () => ({
        executeCanary: async () => ({ status: 0, body: null }),
      }),
      fetchImpl: async () => {
        throw new Error('not used')
      },
      nowSeconds: () => NOW_SECONDS,
      readEffectiveUserId: () => EFFECTIVE_USER_ID,
    },
  )

  const error = await captureFailure(() => dependencies.loadFixtureEvidence())

  assert.equal(error.message, 'PERF-P2 runtime adapter failed at token-fixture-read')
  assert.equal(closeCalls, 1)
})

test('maps database identity only after the connector client closes successfully', async () => {
  const harness = createHarness()
  const evidence = await harness.dependencies.readDatabaseEvidence()

  assert.deepEqual(evidence, {
    database: DATABASE,
    databaseHostFingerprint: DATABASE_HOST_FINGERPRINT,
    databaseCurrentDate: CURRENT_DATE,
    connectionClosed: true,
  })
  assert.equal(harness.databaseCloseCalls, 1)
  assert.deepEqual(
    harness.events.filter((event) => event.includes('database')),
    ['connect-database', 'close-database'],
  )
})

test('closes invalid database identities and suppresses connector failures', async () => {
  const invalidIdentity = createDatabaseIdentity()
  invalidIdentity.wall_date = '2026-09-17'

  const identityHarness = createHarness({
    identity: invalidIdentity,
  })
  const identityError = await captureFailure(() =>
    identityHarness.dependencies.readDatabaseEvidence(),
  )

  assert.equal(identityError.message, 'PERF-P2 runtime adapter failed at database-identity')
  assert.equal(identityHarness.databaseCloseCalls, 1)

  const connectHarness = createHarness({
    connectError: new Error(PRIVATE_RAW_ERROR),
  })
  const connectError = await captureFailure(() =>
    connectHarness.dependencies.readDatabaseEvidence(),
  )

  assert.equal(connectError.message, 'PERF-P2 runtime adapter failed at database-connect')
  assert.equal(connectError.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(connectHarness.databaseCloseCalls, 0)
})

test('sanitizes hostile database identity access and still closes the client', async () => {
  let closeCalls = 0

  const dependencies = createP2PremeasurementRuntimeDependencies(
    {
      environment: {
        DATABASE_URL: PRIVATE_DATABASE_URL,
        PERF_LOGIN_PASSWORD: PRIVATE_PASSWORD,
      },
      observeDeployment: async () => createDeploymentEvidence(),
    },
    {
      openTokenFixture: async () => {
        throw new Error('not used')
      },
      connectToStaging: async () => {
        const connection = {
          client: {
            async end() {
              closeCalls += 1
            },
          },
        }

        Object.defineProperty(connection, 'identity', {
          enumerable: true,
          get() {
            throw new Error(PRIVATE_RAW_ERROR)
          },
        })

        return connection
      },
      createHttpAdapter: () => ({
        executeCanary: async () => ({ status: 0, body: null }),
      }),
      fetchImpl: async () => {
        throw new Error('not used')
      },
      nowSeconds: () => NOW_SECONDS,
      readEffectiveUserId: () => EFFECTIVE_USER_ID,
    },
  )

  const error = await captureFailure(() => dependencies.readDatabaseEvidence())

  assert.equal(error.message, 'PERF-P2 runtime adapter failed at database-identity')
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(closeCalls, 1)
})

test('fails closed when database client closure cannot be confirmed', async () => {
  const harness = createHarness({
    closeDatabaseError: new Error(PRIVATE_RAW_ERROR),
  })

  const error = await captureFailure(() => harness.dependencies.readDatabaseEvidence())

  assert.equal(error.message, 'PERF-P2 runtime adapter failed at database-close')
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(harness.databaseCloseCalls, 1)
})

test('reads the login password lazily and rejects unsafe clock values', async () => {
  let passwordReads = 0

  const environment = {
    DATABASE_URL: PRIVATE_DATABASE_URL,
    get PERF_LOGIN_PASSWORD() {
      passwordReads += 1
      return PRIVATE_PASSWORD
    },
  }

  const dependencies = createP2PremeasurementRuntimeDependencies(
    {
      environment,
      observeDeployment: async () => createDeploymentEvidence(),
    },
    {
      openTokenFixture: async () => {
        throw new Error('not used')
      },
      connectToStaging: async () => {
        throw new Error('not used')
      },
      createHttpAdapter: () => ({
        executeCanary: async () => ({ status: 0, body: null }),
      }),
      fetchImpl: async () => {
        throw new Error('not used')
      },
      nowSeconds: () => NOW_SECONDS,
      readEffectiveUserId: () => EFFECTIVE_USER_ID,
    },
  )

  assert.equal(passwordReads, 0)
  assert.equal(dependencies.readLoginPassword(), PRIVATE_PASSWORD)
  assert.equal(passwordReads, 1)

  const unsafeClock = createHarness({
    clock: () => NOW_SECONDS + 0.5,
  })
  const clockError = await captureFailure(async () => unsafeClock.dependencies.nowSeconds())

  assert.equal(clockError.message, 'PERF-P2 runtime adapter failed at clock')
})

test('deployment observation failures are sanitized without environment self-attestation', async () => {
  const harness = createHarness({
    observeError: new Error(PRIVATE_RAW_ERROR),
  })

  const error = await captureFailure(() => harness.dependencies.observeDeployment())

  assert.equal(error.message, 'PERF-P2 runtime adapter failed at deployment-observation')
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  assert.deepEqual(harness.events, ['observe-deployment'])
})

test('composes the real offline runner without leaking runtime fixture values', async () => {
  const harness = createHarness()

  const summary = await runP2Premeasurement(
    {
      baseUrl: BASE_URL,
      approvedTarget: {
        gitCommit: GIT_COMMIT,
        imageDigest: IMAGE_DIGEST,
        originFingerprint: fingerprint(BASE_URL),
        taskDefinitionRevision: 42,
      },
    },
    harness.dependencies,
  )

  assert.equal(summary.ready, true)
  assert.equal(summary.fixtureInvalidated, false)
  assert.equal(summary.secretsReturned, false)
  assert.equal(harness.fixtureCloseCalls, 1)
  assert.equal(harness.databaseCloseCalls, 1)
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:/api/health', 'http:/api/auth/login', 'http:/api/me'],
  )

  const serialized = JSON.stringify(summary)

  for (const privateValue of [
    BASE_URL,
    PRIVATE_PASSWORD,
    PRIVATE_EMAIL,
    PRIVATE_ANSWER,
    PRIVATE_DATABASE_URL,
    FIXTURE.users[0].token,
    String(FIXTURE.users[0].userId),
    DATABASE_HOST_FINGERPRINT,
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('source contains no logging or local staging environment fallback', async () => {
  const source = await readFile(
    new URL('./premeasurement-runtime-adapters.mjs', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /\.env\.staging/)
  assert.doesNotMatch(source, /\bconsole\./)
})
