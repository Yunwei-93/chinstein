import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as runnerModule from './premeasurement-runner.mjs'

const { runP2Premeasurement } = runnerModule

const BASE_URL = 'https://staging.example.invalid'
const DATABASE = 'neondb'
const DATABASE_HOST_FINGERPRINT = '777c6ca41572'
const USER_ID = 10_001
const TOKEN_TTL_SECONDS = 14_400
const NOW_SECONDS = Math.floor(Date.parse('2026-09-18T12:00:00.000Z') / 1000)
const CURRENT_DATE = '2026-09-18'

const PRIVATE_FIXTURE_TOKEN = 'private-fixture-token'
const PRIVATE_LOGIN_TOKEN = 'private-login-response-token'
const PRIVATE_EMAIL = 'player_00001@example.invalid'
const PRIVATE_ANSWER = 'private-daily-answer'
const PRIVATE_PASSWORD = 'private-login-password-value-000001'
const PRIVATE_RAW_ERROR = `${PRIVATE_FIXTURE_TOKEN}:${PRIVATE_PASSWORD}:${PRIVATE_EMAIL}`

const IMAGE_DIGEST = `sha256:${'a'.repeat(64)}`
const GIT_COMMIT = 'b'.repeat(40)

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function createApprovedTarget() {
  return {
    gitCommit: GIT_COMMIT,
    imageDigest: IMAGE_DIGEST,
    originFingerprint: fingerprint(BASE_URL),
    taskDefinitionRevision: 42,
  }
}

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

function createDatabaseEvidence() {
  return {
    database: DATABASE,
    databaseHostFingerprint: DATABASE_HOST_FINGERPRINT,
    databaseCurrentDate: CURRENT_DATE,
    connectionClosed: true,
  }
}

function createFixtureEvidence() {
  const earliestIssuedAt = NOW_SECONDS - 120
  const latestIssuedAt = NOW_SECONDS - 60
  const generatedAt = NOW_SECONDS - 60
  const loadedAt = NOW_SECONDS - 30
  const earliestExpiresAt = earliestIssuedAt + TOKEN_TTL_SECONDS

  return {
    fixtureMetadata: {
      type: 'p2-token-fixture-metadata',
      schemaVersion: 1,
      generatedAt,
      loadedAt,
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
        sequence: 1,
        email: PRIVATE_EMAIL,
      },
      users: 8100,
      pools: {
        R: 900,
        A: 7000,
        B: 200,
      },
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      earliestIssuedAt,
      latestIssuedAt,
      earliestExpiresAt,
      remainingTokenSeconds: earliestExpiresAt - loadedAt,
      tokensReturned: false,
      secretsReturned: false,
    },
    designatedUser: {
      sequence: 1,
      userId: USER_ID,
      pool: 'R',
      token: PRIVATE_FIXTURE_TOKEN,
      issuedAt: earliestIssuedAt,
      expiresAt: earliestExpiresAt,
    },
  }
}

function createCanaryResponse(canaryId) {
  switch (canaryId) {
    case 'health':
      return {
        status: 200,
        body: {
          status: 'ok',
          time: `${CURRENT_DATE}T12:00:00.000Z`,
        },
      }

    case 'login':
      return {
        status: 200,
        body: {
          token: PRIVATE_LOGIN_TOKEN,
          user: {
            id: USER_ID,
            name: 'player_00001',
          },
        },
      }

    case 'protected':
      return {
        status: 200,
        body: {
          id: USER_ID,
          name: 'player_00001',
          points: 0,
          streak: 0,
          badges: [],
          learnedCharacterIds: [],
          completedToday: false,
        },
      }

    default:
      throw new Error('unexpected canary')
  }
}

function createHarness(overrides = {}) {
  const events = []
  const credentials = []
  const fixtureEvidence = createFixtureEvidence()
  const deploymentEvidence = createDeploymentEvidence()
  const databaseEvidence = createDatabaseEvidence()

  const dependencies = {
    async loadFixtureEvidence() {
      events.push('load-fixture')
      return fixtureEvidence
    },

    async observeDeployment() {
      events.push('observe-deployment')
      return deploymentEvidence
    },

    async readDatabaseEvidence() {
      events.push('read-database')
      return databaseEvidence
    },

    nowSeconds() {
      events.push('clock')
      return NOW_SECONDS
    },

    async readLoginPassword() {
      events.push('read-password')
      return PRIVATE_PASSWORD
    },

    async executeCanary({ baseUrl, canary, credential }) {
      events.push(`http:${canary.canaryId}`)
      credentials.push({
        baseUrl,
        canaryId: canary.canaryId,
        credential,
      })

      return createCanaryResponse(canary.canaryId)
    },
  }

  Object.assign(dependencies, overrides)

  return {
    options: {
      baseUrl: BASE_URL,
      approvedTarget: createApprovedTarget(),
    },
    dependencies,
    events,
    credentials,
    fixtureEvidence,
    deploymentEvidence,
    databaseEvidence,
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

test('exports only the approved premeasurement runner surface', () => {
  assert.deepEqual(Object.keys(runnerModule), ['runP2Premeasurement'])
})

test('runs the exact safe canary order and returns only the final ready summary', async () => {
  const harness = createHarness()
  const summary = await runP2Premeasurement(harness.options, harness.dependencies)

  assert.deepEqual(harness.events, [
    'load-fixture',
    'observe-deployment',
    'read-database',
    'clock',
    'http:health',
    'clock',
    'read-password',
    'http:login',
    'clock',
    'http:protected',
    'clock',
  ])

  assert.deepEqual(harness.credentials, [
    {
      baseUrl: BASE_URL,
      canaryId: 'health',
      credential: {
        type: 'none',
      },
    },
    {
      baseUrl: BASE_URL,
      canaryId: 'login',
      credential: {
        type: 'runtime-login-password',
        email: PRIVATE_EMAIL,
        password: PRIVATE_PASSWORD,
      },
    },
    {
      baseUrl: BASE_URL,
      canaryId: 'protected',
      credential: {
        type: 'fixture-token',
        token: PRIVATE_FIXTURE_TOKEN,
      },
    },
  ])

  assert.equal(summary.check, 'p2-premeasurement-ready')
  assert.equal(summary.ready, true)
  assert.equal(summary.fixtureInvalidated, false)
  assert.equal(summary.secretsReturned, false)

  const serialized = JSON.stringify(summary)

  for (const privateValue of [
    BASE_URL,
    fingerprint(BASE_URL),
    DATABASE_HOST_FINGERPRINT,
    PRIVATE_FIXTURE_TOKEN,
    PRIVATE_LOGIN_TOKEN,
    PRIVATE_EMAIL,
    PRIVATE_ANSWER,
    PRIVATE_PASSWORD,
    String(USER_ID),
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('blocks all HTTP and password access when the pre-canary gate rejects the target', async () => {
  const harness = createHarness()
  harness.deploymentEvidence.stage = 'production'

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at pre-canary-gate')
  assert.deepEqual(harness.events, ['load-fixture', 'observe-deployment', 'read-database', 'clock'])
})

test('requires database cleanup confirmation before reading the clock or sending HTTP', async () => {
  const harness = createHarness()
  harness.databaseEvidence.connectionClosed = false

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at read-database')
  assert.deepEqual(harness.events, ['load-fixture', 'observe-deployment', 'read-database'])
})

test('a failed health canary prevents password access and all authenticated HTTP', async () => {
  const harness = createHarness({
    async executeCanary({ canary }) {
      harness.events.push(`http:${canary.canaryId}`)

      return {
        status: 500,
        body: {
          error: PRIVATE_RAW_ERROR,
        },
      }
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at health-canary')
  assert.equal(harness.events.includes('read-password'), false)
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:health'],
  )
})

test('an invalid runtime password blocks login and protected canaries', async () => {
  const harness = createHarness({
    async readLoginPassword() {
      harness.events.push('read-password')
      return 'too-short'
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at read-login-password')
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:health'],
  )
})

test('a failed login canary blocks the protected fixture-token request', async () => {
  const harness = createHarness({
    async executeCanary({ canary }) {
      harness.events.push(`http:${canary.canaryId}`)

      if (canary.canaryId === 'login') {
        return {
          status: 200,
          body: {
            token: PRIVATE_LOGIN_TOKEN,
            user: {
              id: USER_ID + 1,
              name: 'wrong-player',
            },
          },
        }
      }

      return createCanaryResponse(canary.canaryId)
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at login-canary')
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:health', 'http:login'],
  )
})

test('a protected 401 invalidates the fixture and is never retried', async () => {
  const harness = createHarness({
    async executeCanary({ canary }) {
      harness.events.push(`http:${canary.canaryId}`)

      if (canary.canaryId === 'protected') {
        return {
          status: 401,
          body: {
            error: PRIVATE_RAW_ERROR,
          },
        }
      }

      return createCanaryResponse(canary.canaryId)
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at fixture-invalidated')
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:health', 'http:login', 'http:protected'],
  )
})

test('rejects malformed HTTP adapter results before any later credential use', async () => {
  const harness = createHarness({
    async executeCanary({ canary }) {
      harness.events.push(`http:${canary.canaryId}`)

      return {
        status: 200,
        body: createCanaryResponse('health').body,
        rawBody: PRIVATE_RAW_ERROR,
      }
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at health-canary')
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  assert.equal(harness.events.includes('read-password'), false)
})

test('suppresses raw dependency failures that contain private values', async () => {
  const cases = [
    {
      expectedStage: 'load-fixture',
      overrides: {
        async loadFixtureEvidence() {
          throw new Error(PRIVATE_RAW_ERROR)
        },
      },
    },
    {
      expectedStage: 'observe-deployment',
      overrides: {
        async observeDeployment() {
          throw new Error(PRIVATE_RAW_ERROR)
        },
      },
    },
    {
      expectedStage: 'read-database',
      overrides: {
        async readDatabaseEvidence() {
          throw new Error(PRIVATE_RAW_ERROR)
        },
      },
    },
    {
      expectedStage: 'health-canary',
      overrides: {
        async executeCanary() {
          throw new Error(PRIVATE_RAW_ERROR)
        },
      },
    },
  ]

  for (const { expectedStage, overrides } of cases) {
    const harness = createHarness(overrides)
    const error = await captureFailure(() =>
      runP2Premeasurement(harness.options, harness.dependencies),
    )

    assert.equal(error.message, `PERF-P2 premeasurement runner failed at ${expectedStage}`)
    assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
  }
})

test('rechecks the UTC safety window and token lifetime before each sensitive boundary', async () => {
  const finalGuardBoundary = Math.floor(Date.parse('2026-09-18T23:30:00.000Z') / 1000)
  const clocks = [NOW_SECONDS, NOW_SECONDS, NOW_SECONDS, finalGuardBoundary]
  const harness = createHarness({
    nowSeconds() {
      harness.events.push('clock')
      return clocks.shift()
    },
  })

  const error = await captureFailure(() =>
    runP2Premeasurement(harness.options, harness.dependencies),
  )

  assert.equal(error.message, 'PERF-P2 premeasurement runner failed at final-gate')
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('http:')),
    ['http:health', 'http:login', 'http:protected'],
  )
  assert.equal(clocks.length, 0)
})

test('invalid options or dependency surfaces fail before any injected operation runs', async () => {
  const harness = createHarness()
  const invalidOptions = {
    ...harness.options,
    unexpected: true,
  }

  const optionError = await captureFailure(() =>
    runP2Premeasurement(invalidOptions, harness.dependencies),
  )

  assert.equal(optionError.message, 'PERF-P2 premeasurement runner failed at validate-options')
  assert.deepEqual(harness.events, [])

  const missingDependency = {
    ...harness.dependencies,
  }

  delete missingDependency.observeDeployment

  const dependencyError = await captureFailure(() =>
    runP2Premeasurement(harness.options, missingDependency),
  )

  assert.equal(
    dependencyError.message,
    'PERF-P2 premeasurement runner failed at validate-dependencies',
  )
  assert.deepEqual(harness.events, [])
})

test('remains an injected offline coordinator with no live-system adapter', async () => {
  const source = await readFile(new URL('./premeasurement-runner.mjs', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /from ['"]k6\/http['"]/)
  assert.doesNotMatch(source, /@aws-sdk/)
  assert.doesNotMatch(source, /from ['"]aws-sdk['"]/)
  assert.doesNotMatch(source, /from ['"]node:fs/)
  assert.doesNotMatch(source, /from ['"]pg['"]/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /DATABASE_URL/)
  assert.doesNotMatch(source, /process\.env/)
  assert.doesNotMatch(source, /\bconsole\./)
})
