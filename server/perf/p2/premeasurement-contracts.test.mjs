import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as premeasurementContracts from './premeasurement-contracts.mjs'
import {
  buildSharedTokenFixtureRecords,
  readSharedTokenFixtureMetadata,
  readSharedTokenUser,
} from './k6/k6-token-fixture-contracts.mjs'

const {
  assertP2PremeasurementReady,
  buildP2PremeasurementCanaryPlan,
  classifyP2PremeasurementCanary,
} = premeasurementContracts

const BASE_URL = 'https://staging.example.invalid'
const DATABASE_HOST_FINGERPRINT = '777c6ca41572'
const DATABASE = 'neondb'
const USER_ID = 10_001
const TOKEN_TTL_SECONDS = 14_400
const MINIMUM_REMAINING_TOKEN_SECONDS = 10_800
const PRIVATE_TOKEN = 'private-fixture-token'
const PRIVATE_LOGIN_TOKEN = 'private-login-response-token'
const PRIVATE_EMAIL = 'player_00001@example.invalid'
const PRIVATE_ANSWER = 'private-daily-answer'
const PRIVATE_PASSWORD = 'private-login-password'

const IMAGE_DIGEST = `sha256:${'a'.repeat(64)}`
const GIT_COMMIT = 'b'.repeat(40)
const NOW_SECONDS = Math.floor(Date.parse('2026-09-18T12:00:00.000Z') / 1000)

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function utcDate(nowSeconds) {
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10)
}

function createApprovedTarget() {
  return {
    gitCommit: GIT_COMMIT,
    imageDigest: IMAGE_DIGEST,
    originFingerprint: fingerprint(BASE_URL),
    taskDefinitionRevision: 42,
  }
}

function createObservedTarget() {
  return {
    database: DATABASE,
    databaseHostFingerprint: DATABASE_HOST_FINGERPRINT,
    deploymentStatus: 'COMPLETED',
    desiredCount: 1,
    gitCommit: GIT_COMMIT,
    imageDigest: IMAGE_DIGEST,
    originFingerprint: fingerprint(BASE_URL),
    pendingCount: 0,
    region: 'us-east-2',
    runningCount: 1,
    service: 'chinstein-api-staging',
    stage: 'aws-staging',
    taskDefinitionRevision: 42,
  }
}

function createFixtureMetadata(nowSeconds = NOW_SECONDS) {
  const earliestIssuedAt = nowSeconds - 120
  const latestIssuedAt = nowSeconds - 60
  const generatedAt = nowSeconds - 60
  const loadedAt = nowSeconds - 30
  const earliestExpiresAt = earliestIssuedAt + TOKEN_TTL_SECONDS

  return {
    type: 'p2-token-fixture-metadata',
    schemaVersion: 1,
    generatedAt,
    loadedAt,
    source: {
      hostFingerprint: DATABASE_HOST_FINGERPRINT,
      database: DATABASE,
      seedDate: utcDate(nowSeconds),
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
  }
}

function createDesignatedUser(nowSeconds = NOW_SECONDS) {
  const issuedAt = nowSeconds - 120

  return {
    sequence: 1,
    userId: USER_ID,
    pool: 'R',
    token: PRIVATE_TOKEN,
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_SECONDS,
  }
}

function classifyHealth({ expectedDate, time = `${expectedDate}T12:00:00.000Z` } = {}) {
  return classifyP2PremeasurementCanary({
    canaryId: 'health',
    status: 200,
    body: {
      status: 'ok',
      time,
    },
    expectedUserId: null,
    expectedDate,
    originFingerprint: fingerprint(BASE_URL),
    credentialSource: 'none',
    userSequence: null,
  })
}

function classifyLogin({
  expectedDate,
  expectedUserId = USER_ID,
  userId = expectedUserId,
  token = PRIVATE_LOGIN_TOKEN,
  status = 200,
  originFingerprint = fingerprint(BASE_URL),
} = {}) {
  return classifyP2PremeasurementCanary({
    canaryId: 'login',
    status,
    body: {
      token,
      user: {
        id: userId,
        name: 'player_00001',
      },
    },
    expectedUserId,
    expectedDate,
    originFingerprint,
    credentialSource: 'runtime-login-password',
    userSequence: 1,
  })
}

function classifyProtected({
  expectedDate,
  expectedUserId = USER_ID,
  status = 200,
  userId = expectedUserId,
  originFingerprint = fingerprint(BASE_URL),
} = {}) {
  return classifyP2PremeasurementCanary({
    canaryId: 'protected',
    status,
    body:
      status === 200
        ? {
            id: userId,
            name: 'player_00001',
            points: 0,
            streak: 0,
            badges: [],
            learnedCharacterIds: [],
            completedToday: false,
          }
        : {
            error: 'unauthorized',
          },
    expectedUserId,
    expectedDate,
    originFingerprint,
    credentialSource: 'fixture-token',
    userSequence: 1,
  })
}

function createReadyInput(nowSeconds = NOW_SECONDS) {
  const expectedDate = utcDate(nowSeconds)

  return {
    approvedTarget: createApprovedTarget(),
    observedTarget: createObservedTarget(),
    fixtureMetadata: createFixtureMetadata(nowSeconds),
    designatedUser: createDesignatedUser(nowSeconds),
    nowSeconds,
    databaseCurrentDate: expectedDate,
    canaries: [
      classifyHealth({ expectedDate }),
      classifyLogin({ expectedDate }),
      classifyProtected({ expectedDate }),
    ],
  }
}

function assertGateFailure(input, pattern = /PERF-P2 premeasurement gate failed/) {
  assert.throws(() => assertP2PremeasurementReady(input), pattern)
}

test('exports only the approved premeasurement contract surface', () => {
  assert.deepEqual(Object.keys(premeasurementContracts).sort(), [
    'assertP2PremeasurementReady',
    'buildP2PremeasurementCanaryPlan',
    'classifyP2PremeasurementCanary',
  ])
})

test('builds the exact safe health, login, and fixture-token canary plan', () => {
  const input = createReadyInput()
  const plan = buildP2PremeasurementCanaryPlan({
    baseUrl: BASE_URL,
    approvedTarget: input.approvedTarget,
    fixtureMetadata: input.fixtureMetadata,
    designatedUser: input.designatedUser,
  })

  assert.deepEqual(plan, {
    check: 'p2-premeasurement-canary-plan',
    canaries: [
      {
        canaryId: 'health',
        scenarioId: 'S0',
        method: 'GET',
        path: '/api/health',
        credentialSource: 'none',
        userSequence: null,
        expectedStatus: 200,
      },
      {
        canaryId: 'login',
        scenarioId: 'S1',
        method: 'POST',
        path: '/api/auth/login',
        credentialSource: 'runtime-login-password',
        userSequence: 1,
        expectedStatus: 200,
      },
      {
        canaryId: 'protected',
        scenarioId: 'S3',
        method: 'GET',
        path: '/api/me',
        credentialSource: 'fixture-token',
        userSequence: 1,
        expectedStatus: 200,
      },
    ],
    secretsReturned: false,
  })

  const serialized = JSON.stringify(plan)

  for (const privateValue of [
    BASE_URL,
    input.approvedTarget.originFingerprint,
    PRIVATE_TOKEN,
    PRIVATE_EMAIL,
    PRIVATE_ANSWER,
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('binds the canary plan to one canonical approved HTTPS origin', () => {
  const input = createReadyInput()
  const base = {
    approvedTarget: input.approvedTarget,
    fixtureMetadata: input.fixtureMetadata,
    designatedUser: input.designatedUser,
  }

  for (const baseUrl of [
    `${BASE_URL}/`,
    'http://staging.example.invalid',
    `${BASE_URL}/api/health`,
    'https://other.example.invalid',
  ]) {
    assert.throws(
      () =>
        buildP2PremeasurementCanaryPlan({
          ...base,
          baseUrl,
        }),
      /PERF-P2 premeasurement gate failed/,
    )
  }

  assert.throws(
    () =>
      buildP2PremeasurementCanaryPlan({
        ...base,
        baseUrl: BASE_URL,
        approvedTarget: {
          ...input.approvedTarget,
          originFingerprint: 'ffffffffffff',
        },
      }),
    /PERF-P2 premeasurement gate failed/,
  )
})

test('classifies all three successful canaries without returning response secrets', () => {
  const expectedDate = utcDate(NOW_SECONDS)
  const canaries = [
    classifyHealth({ expectedDate }),
    classifyLogin({ expectedDate }),
    classifyProtected({ expectedDate }),
  ]

  assert.deepEqual(canaries[0], {
    canaryId: 'health',
    scenarioId: 'S0',
    credentialSource: 'none',
    userSequence: null,
    expectedDate,
    expectedUserId: null,
    originFingerprint: fingerprint(BASE_URL),
    status: 200,
    passed: true,
    category: 'expected',
    databaseDateMatched: true,
    userIdMatched: null,
    fixtureInvalidated: false,
    secretsReturned: false,
  })

  assert.equal(canaries[1].passed, true)
  assert.equal(canaries[1].userIdMatched, true)
  assert.equal(canaries[1].credentialSource, 'runtime-login-password')
  assert.equal(canaries[2].passed, true)
  assert.equal(canaries[2].userIdMatched, true)
  assert.equal(canaries[2].credentialSource, 'fixture-token')

  const serialized = JSON.stringify(canaries)

  for (const privateValue of [PRIVATE_LOGIN_TOKEN, PRIVATE_EMAIL, 'player_00001']) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('fails canaries with a noncanonical health time or mismatched user', () => {
  const expectedDate = utcDate(NOW_SECONDS)

  const noncanonicalHealth = classifyHealth({
    expectedDate,
    time: `${expectedDate}T12:00:00`,
  })

  const wrongLoginUser = classifyLogin({
    expectedDate,
    userId: USER_ID + 1,
  })

  const missingLoginToken = classifyLogin({
    expectedDate,
    token: '',
  })

  const wrongProtectedUser = classifyProtected({
    expectedDate,
    userId: USER_ID + 1,
  })

  assert.equal(noncanonicalHealth.passed, false)
  assert.equal(noncanonicalHealth.databaseDateMatched, false)
  assert.equal(wrongLoginUser.passed, false)
  assert.equal(wrongLoginUser.userIdMatched, false)
  assert.equal(missingLoginToken.passed, false)
  assert.equal(wrongProtectedUser.passed, false)
  assert.equal(wrongProtectedUser.userIdMatched, false)
})

test('marks a protected 401 as fixture invalidation and rejects wrong credential evidence', () => {
  const expectedDate = utcDate(NOW_SECONDS)
  const invalidated = classifyProtected({
    expectedDate,
    status: 401,
  })

  assert.equal(invalidated.passed, false)
  assert.equal(invalidated.category, 'fixture-invalidated')
  assert.equal(invalidated.fixtureInvalidated, true)

  assert.throws(
    () =>
      classifyP2PremeasurementCanary({
        canaryId: 'protected',
        status: 200,
        body: {},
        expectedUserId: USER_ID,
        expectedDate,
        originFingerprint: fingerprint(BASE_URL),
        credentialSource: 'runtime-login-password',
        userSequence: 1,
      }),
    /PERF-P2 premeasurement gate failed/,
  )

  assert.throws(
    () =>
      classifyP2PremeasurementCanary({
        canaryId: 'protected',
        status: 200,
        body: {},
        expectedUserId: USER_ID,
        expectedDate,
        originFingerprint: fingerprint(BASE_URL),
        credentialSource: 'fixture-token',
        userSequence: 2,
      }),
    /PERF-P2 premeasurement gate failed/,
  )
})

test('returns the exact safe ready summary for the approved state', () => {
  const input = createReadyInput()
  const summary = assertP2PremeasurementReady(input)

  assert.deepEqual(summary, {
    check: 'p2-premeasurement-ready',
    ready: true,
    target: {
      stage: 'aws-staging',
      region: 'us-east-2',
      service: 'chinstein-api-staging',
      taskDefinitionRevision: 42,
      imageDigest: IMAGE_DIGEST,
      gitCommit: GIT_COMMIT,
      deploymentStatus: 'COMPLETED',
      desiredCount: 1,
      runningCount: 1,
      pendingCount: 0,
    },
    date: {
      databaseCurrentDate: '2026-09-18',
      fixtureSeedDate: '2026-09-18',
      secondsSinceMidnight: 43_200,
      secondsUntilMidnight: 43_200,
      midnightGuardSeconds: 1800,
    },
    fixture: {
      users: 8100,
      tokenTtlSeconds: TOKEN_TTL_SECONDS,
      remainingTokenSeconds: 14_280,
    },
    canaries: [
      {
        canaryId: 'health',
        status: 200,
        passed: true,
        fixtureInvalidated: false,
      },
      {
        canaryId: 'login',
        status: 200,
        passed: true,
        fixtureInvalidated: false,
      },
      {
        canaryId: 'protected',
        status: 200,
        passed: true,
        fixtureInvalidated: false,
      },
    ],
    fixtureInvalidated: false,
    secretsReturned: false,
  })

  assert.deepEqual(Object.keys(summary).sort(), [
    'canaries',
    'check',
    'date',
    'fixture',
    'fixtureInvalidated',
    'ready',
    'secretsReturned',
    'target',
  ])

  const serialized = JSON.stringify(summary)

  for (const privateValue of [
    BASE_URL,
    input.approvedTarget.originFingerprint,
    DATABASE_HOST_FINGERPRINT,
    PRIVATE_TOKEN,
    PRIVATE_LOGIN_TOKEN,
    PRIVATE_EMAIL,
    PRIVATE_ANSWER,
    String(USER_ID),
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('rejects every approved-versus-observed target mismatch', () => {
  const cases = [
    (input) => {
      input.approvedTarget.originFingerprint = 'ffffffffffff'
    },
    (input) => {
      input.approvedTarget.taskDefinitionRevision += 1
    },
    (input) => {
      input.approvedTarget.imageDigest = `sha256:${'c'.repeat(64)}`
    },
    (input) => {
      input.approvedTarget.gitCommit = 'd'.repeat(40)
    },
    (input) => {
      input.observedTarget.stage = 'production'
    },
    (input) => {
      input.observedTarget.region = 'us-east-1'
    },
    (input) => {
      input.observedTarget.service = 'chinstein-api-production'
    },
    (input) => {
      input.observedTarget.deploymentStatus = 'IN_PROGRESS'
    },
    (input) => {
      input.observedTarget.desiredCount = 2
    },
    (input) => {
      input.observedTarget.runningCount = 0
    },
    (input) => {
      input.observedTarget.pendingCount = 1
    },
    (input) => {
      input.observedTarget.database = 'other_database'
    },
    (input) => {
      input.observedTarget.databaseHostFingerprint = 'ffffffffffff'
    },
    (input) => {
      input.observedTarget.unexpected = true
    },
  ]

  for (const mutate of cases) {
    const input = createReadyInput()
    mutate(input)
    assertGateFailure(input)
  }
})

test('binds canary evidence to the gate target, date, and designated user', () => {
  const wrongOrigin = createReadyInput()
  wrongOrigin.canaries = wrongOrigin.canaries.map((canary) => ({
    ...canary,
    originFingerprint: 'ffffffffffff',
  }))
  assertGateFailure(wrongOrigin)

  const wrongDate = createReadyInput()
  wrongDate.canaries[0] = classifyHealth({
    expectedDate: '2026-09-17',
    time: '2026-09-17T12:00:00.000Z',
  })
  assert.equal(wrongDate.canaries[0].passed, true)
  assertGateFailure(wrongDate)

  const wrongLoginSubject = createReadyInput()
  wrongLoginSubject.canaries[1] = classifyLogin({
    expectedDate: wrongLoginSubject.databaseCurrentDate,
    expectedUserId: USER_ID + 1,
  })
  assert.equal(wrongLoginSubject.canaries[1].passed, true)
  assertGateFailure(wrongLoginSubject)

  const wrongProtectedSubject = createReadyInput()
  wrongProtectedSubject.canaries[2] = classifyProtected({
    expectedDate: wrongProtectedSubject.databaseCurrentDate,
    expectedUserId: USER_ID + 1,
  })
  assert.equal(wrongProtectedSubject.canaries[2].passed, true)
  assertGateFailure(wrongProtectedSubject)
})

test('accepts metadata and the designated user produced by the real shared fixture loader', () => {
  const issuedAt = NOW_SECONDS - 120
  const fixture = {
    schemaVersion: 1,
    generatedAt: NOW_SECONDS - 60,
    source: {
      hostFingerprint: DATABASE_HOST_FINGERPRINT,
      database: DATABASE,
      seedDate: utcDate(NOW_SECONDS),
    },
    dailyCharacter: {
      id: 274,
      answer: PRIVATE_ANSWER,
    },
    login: {
      sequence: 1,
      email: PRIVATE_EMAIL,
    },
    users: Array.from({ length: 8100 }, (_, index) => {
      const sequence = index + 1
      const pool = sequence <= 900 ? 'R' : sequence <= 7900 ? 'A' : 'B'

      return {
        sequence,
        userId: 10_000 + sequence,
        pool,
        token: `fixture-token-${sequence}`,
        issuedAt,
        expiresAt: issuedAt + TOKEN_TTL_SECONDS,
      }
    }),
  }

  const records = buildSharedTokenFixtureRecords(JSON.stringify(fixture), {
    nowSeconds: () => NOW_SECONDS - 30,
  })

  const fixtureMetadata = readSharedTokenFixtureMetadata(records)
  const designatedUser = readSharedTokenUser(records, 1, 'R')
  const input = createReadyInput()

  input.fixtureMetadata = fixtureMetadata
  input.designatedUser = designatedUser

  assert.equal(assertP2PremeasurementReady(input).ready, true)
})

test('requires one strict date across UTC, database, fixture, and health evidence', () => {
  const invalidDatabaseDate = createReadyInput()
  invalidDatabaseDate.databaseCurrentDate = '2026-02-30'
  assertGateFailure(invalidDatabaseDate)

  const fixtureDateMismatch = createReadyInput()
  fixtureDateMismatch.fixtureMetadata.source.seedDate = '2026-09-17'
  assertGateFailure(fixtureDateMismatch)

  const healthDateMismatch = createReadyInput()
  healthDateMismatch.canaries[0] = classifyHealth({
    expectedDate: '2026-09-18',
    time: '2026-09-17T23:59:59.000Z',
  })
  assertGateFailure(healthDateMismatch)

  const utcDateMismatch = createReadyInput()
  utcDateMismatch.nowSeconds += 24 * 60 * 60
  assertGateFailure(utcDateMismatch)
})

test('fails closed at both UTC midnight boundaries and passes one second outside', () => {
  const exactMorningBoundary = Math.floor(Date.parse('2026-09-18T00:30:00.000Z') / 1000)
  const exactEveningBoundary = Math.floor(Date.parse('2026-09-18T23:30:00.000Z') / 1000)
  const justAfterMorningBoundary = exactMorningBoundary + 1
  const justBeforeEveningBoundary = exactEveningBoundary - 1

  assertGateFailure(createReadyInput(exactMorningBoundary))
  assertGateFailure(createReadyInput(exactEveningBoundary))

  assert.equal(assertP2PremeasurementReady(createReadyInput(justAfterMorningBoundary)).ready, true)
  assert.equal(assertP2PremeasurementReady(createReadyInput(justBeforeEveningBoundary)).ready, true)
})

test('rejects inconsistent fixture timelines and backward clocks', () => {
  const futureIssue = createReadyInput()
  futureIssue.fixtureMetadata.latestIssuedAt = futureIssue.fixtureMetadata.generatedAt + 1
  assertGateFailure(futureIssue)

  const incorrectLoadSummary = createReadyInput()
  incorrectLoadSummary.fixtureMetadata.remainingTokenSeconds += 1
  assertGateFailure(incorrectLoadSummary)

  const loadedAfterExpiry = createReadyInput()
  loadedAfterExpiry.fixtureMetadata.loadedAt = loadedAfterExpiry.fixtureMetadata.earliestExpiresAt
  assertGateFailure(loadedAfterExpiry)

  const userOutsideMetadata = createReadyInput()
  userOutsideMetadata.designatedUser.issuedAt =
    userOutsideMetadata.fixtureMetadata.earliestIssuedAt - 1
  userOutsideMetadata.designatedUser.expiresAt =
    userOutsideMetadata.designatedUser.issuedAt + TOKEN_TTL_SECONDS
  assertGateFailure(userOutsideMetadata)

  const backwardClock = createReadyInput()
  backwardClock.nowSeconds = backwardClock.fixtureMetadata.loadedAt - 1
  assertGateFailure(backwardClock)

  const fractionalClock = createReadyInput()
  fractionalClock.nowSeconds += 0.5
  assertGateFailure(fractionalClock)

  const outOfRangeClock = createReadyInput()
  outOfRangeClock.nowSeconds = Number.MAX_SAFE_INTEGER
  assertGateFailure(outOfRangeClock, /clock is outside the supported date range/)
})

test('accepts exactly three remaining token hours and rejects one second less', () => {
  function setRemainingLifetime(input, remainingSeconds) {
    const issuedAt = input.nowSeconds + remainingSeconds - TOKEN_TTL_SECONDS
    const loadedAt = input.nowSeconds - 10
    const expiresAt = input.nowSeconds + remainingSeconds

    input.fixtureMetadata.earliestIssuedAt = issuedAt
    input.fixtureMetadata.latestIssuedAt = issuedAt
    input.fixtureMetadata.generatedAt = input.nowSeconds - 20
    input.fixtureMetadata.loadedAt = loadedAt
    input.fixtureMetadata.earliestExpiresAt = expiresAt
    input.fixtureMetadata.remainingTokenSeconds = expiresAt - loadedAt
    input.designatedUser.issuedAt = issuedAt
    input.designatedUser.expiresAt = expiresAt
  }

  const exactBoundary = createReadyInput()
  setRemainingLifetime(exactBoundary, MINIMUM_REMAINING_TOKEN_SECONDS)

  assert.equal(assertP2PremeasurementReady(exactBoundary).ready, true)

  const belowBoundary = createReadyInput()
  setRemainingLifetime(belowBoundary, MINIMUM_REMAINING_TOKEN_SECONDS - 1)

  assertGateFailure(belowBoundary)
})

test('rejects an invalid designated fixture user', () => {
  const cases = [
    (input) => {
      input.designatedUser.sequence = 2
    },
    (input) => {
      input.designatedUser.pool = 'A'
    },
    (input) => {
      input.designatedUser.userId = 0
    },
    (input) => {
      input.designatedUser.expiresAt -= 1
    },
    (input) => {
      input.designatedUser.token = ''
    },
  ]

  for (const mutate of cases) {
    const input = createReadyInput()
    mutate(input)
    assertGateFailure(input)
  }
})

test('rejects missing, duplicated, reordered, unsafe, or failed canary evidence', () => {
  const missing = createReadyInput()
  missing.canaries.pop()
  assertGateFailure(missing)

  const reordered = createReadyInput()
  const firstCanary = reordered.canaries[0]
  reordered.canaries[0] = reordered.canaries[1]
  reordered.canaries[1] = firstCanary
  assertGateFailure(reordered)

  const duplicated = createReadyInput()
  duplicated.canaries[2] = duplicated.canaries[1]
  assertGateFailure(duplicated)

  const extraField = createReadyInput()
  extraField.canaries[0] = {
    ...extraField.canaries[0],
    rawBody: PRIVATE_TOKEN,
  }
  assertGateFailure(extraField)

  const wrongCredential = createReadyInput()
  wrongCredential.canaries[2] = {
    ...wrongCredential.canaries[2],
    credentialSource: 'runtime-login-password',
  }
  assertGateFailure(wrongCredential)

  const failedLogin = createReadyInput()
  failedLogin.canaries[1] = classifyLogin({
    expectedDate: failedLogin.databaseCurrentDate,
    userId: USER_ID + 1,
  })
  assertGateFailure(failedLogin)
})

test('derives protected 401 invalidation instead of trusting caller booleans', () => {
  const input = createReadyInput()
  input.canaries[2] = {
    ...input.canaries[2],
    status: 401,
    passed: false,
    category: 'canary-failed',
    fixtureInvalidated: false,
  }

  assertGateFailure(input, /invalidation evidence is inconsistent/)

  const actualInvalidation = createReadyInput()
  actualInvalidation.canaries[2] = classifyProtected({
    expectedDate: actualInvalidation.databaseCurrentDate,
    status: 401,
  })

  assertGateFailure(actualInvalidation, /fixture token was invalidated/)
})

test('blocks transport, authorization, rate-limit, and server failures', () => {
  for (const status of [0, 401, 429, 500]) {
    const input = createReadyInput()
    input.canaries[1] = classifyLogin({
      expectedDate: input.databaseCurrentDate,
      status,
    })

    assert.equal(input.canaries[1].fixtureInvalidated, false)
    assertGateFailure(input)
  }
})

test('never includes private inputs in safe outputs or failure messages', () => {
  const input = createReadyInput()
  const outputs = [
    buildP2PremeasurementCanaryPlan({
      baseUrl: BASE_URL,
      approvedTarget: input.approvedTarget,
      fixtureMetadata: input.fixtureMetadata,
      designatedUser: input.designatedUser,
    }),
    ...input.canaries,
    assertP2PremeasurementReady(input),
  ]

  const messages = []

  try {
    buildP2PremeasurementCanaryPlan({
      baseUrl: `https://${PRIVATE_PASSWORD}.example.invalid`,
      approvedTarget: input.approvedTarget,
      fixtureMetadata: input.fixtureMetadata,
      designatedUser: input.designatedUser,
    })
  } catch (error) {
    messages.push(error.message)
  }

  const failedCanary = createReadyInput()
  failedCanary.canaries[0] = {
    ...failedCanary.canaries[0],
    rawBody: `${PRIVATE_TOKEN}:${PRIVATE_EMAIL}:${PRIVATE_ANSWER}`,
  }

  try {
    assertP2PremeasurementReady(failedCanary)
  } catch (error) {
    messages.push(error.message)
  }

  const serialized = JSON.stringify({
    outputs,
    messages,
  })

  for (const privateValue of [
    PRIVATE_PASSWORD,
    PRIVATE_TOKEN,
    PRIVATE_LOGIN_TOKEN,
    PRIVATE_EMAIL,
    PRIVATE_ANSWER,
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('remains a pure offline contract with no live-system adapter', async () => {
  const source = await readFile(new URL('./premeasurement-contracts.mjs', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /from ['"]k6\/http['"]/)
  assert.doesNotMatch(source, /@aws-sdk/)
  assert.doesNotMatch(source, /from ['"]aws-sdk['"]/)
  assert.doesNotMatch(source, /from ['"]node:https?['"]/)
  assert.doesNotMatch(source, /from ['"]node:net['"]/)
  assert.doesNotMatch(source, /from ['"]node:child_process['"]/)
  assert.doesNotMatch(source, /from ['"]pg['"]/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /DATABASE_URL/)
  assert.doesNotMatch(source, /connectToStaging/)
  assert.doesNotMatch(source, /\bconsole\./)
})
