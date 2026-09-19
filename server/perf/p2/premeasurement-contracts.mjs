import { createHash } from 'node:crypto'

import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'

import { classifyScenarioResponse } from './response-contracts.mjs'
import {
  DESIGNATED_LOGIN_SEQUENCE,
  MINIMUM_REMAINING_TOKEN_SECONDS,
  TOKEN_TTL_SECONDS,
} from './token-fixture-contracts.mjs'
import { normalizeScenarioHttpsOrigin } from './k6/scenario-http-contracts.mjs'

const EXPECTED_STAGE = 'aws-staging'
const EXPECTED_REGION = 'us-east-2'
const EXPECTED_SERVICE = 'chinstein-api-staging'
const EXPECTED_DATABASE = 'neondb'
const EXPECTED_DATABASE_HOST_FINGERPRINT = '777c6ca41572'

const MIDNIGHT_GUARD_SECONDS = 30 * 60
const SECONDS_PER_DAY = 24 * 60 * 60

const APPROVED_TARGET_KEYS = [
  'gitCommit',
  'imageDigest',
  'originFingerprint',
  'taskDefinitionRevision',
]

const OBSERVED_TARGET_KEYS = [
  'database',
  'databaseHostFingerprint',
  'deploymentStatus',
  'desiredCount',
  'gitCommit',
  'imageDigest',
  'originFingerprint',
  'pendingCount',
  'region',
  'runningCount',
  'service',
  'stage',
  'taskDefinitionRevision',
]

const CANARY_RESULT_KEYS = [
  'canaryId',
  'category',
  'credentialSource',
  'databaseDateMatched',
  'expectedDate',
  'expectedUserId',
  'fixtureInvalidated',
  'originFingerprint',
  'passed',
  'scenarioId',
  'secretsReturned',
  'status',
  'userIdMatched',
  'userSequence',
]

const CANARY_DEFINITIONS = Object.freeze([
  Object.freeze({
    canaryId: 'health',
    scenarioId: 'S0',
    method: 'GET',
    path: '/api/health',
    credentialSource: 'none',
    userSequence: null,
    expectedStatus: 200,
  }),
  Object.freeze({
    canaryId: 'login',
    scenarioId: 'S1',
    method: 'POST',
    path: '/api/auth/login',
    credentialSource: 'runtime-login-password',
    userSequence: DESIGNATED_LOGIN_SEQUENCE,
    expectedStatus: 200,
  }),
  Object.freeze({
    canaryId: 'protected',
    scenarioId: 'S3',
    method: 'GET',
    path: '/api/me',
    credentialSource: 'fixture-token',
    userSequence: DESIGNATED_LOGIN_SEQUENCE,
    expectedStatus: 200,
  }),
])

function fail(message) {
  throw new Error(`PERF-P2 premeasurement gate failed: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) {
    return false
  }

  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()

  return JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys)
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{12}$/.test(value)
}

function isImageDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function isGitCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
}

function isStrictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)

  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function fingerprintOrigin(origin) {
  return createHash('sha256').update(origin).digest('hex').slice(0, 12)
}

function utcDateFromUnixSeconds(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    fail('clock must use whole Unix seconds')
  }

  const date = new Date(seconds * 1000)

  if (!Number.isFinite(date.getTime())) {
    fail('clock is outside the supported date range')
  }

  const currentDate = date.toISOString().slice(0, 10)

  if (!isStrictDate(currentDate)) {
    fail('clock is outside the supported date range')
  }

  return currentDate
}

function utcDateFromTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return null
  }

  const milliseconds = Date.parse(value)

  if (!Number.isFinite(milliseconds)) {
    return null
  }

  return new Date(milliseconds).toISOString().slice(0, 10)
}

function validateFixtureShape(metadata) {
  if (!isObject(metadata)) {
    fail('fixture metadata is unavailable')
  }

  if (metadata.type !== 'p2-token-fixture-metadata' || metadata.schemaVersion !== 1) {
    fail('fixture metadata version is not approved')
  }

  if (
    !isObject(metadata.source) ||
    metadata.source.hostFingerprint !== EXPECTED_DATABASE_HOST_FINGERPRINT ||
    metadata.source.database !== EXPECTED_DATABASE ||
    !isStrictDate(metadata.source.seedDate)
  ) {
    fail('fixture source identity is not approved')
  }

  if (
    metadata.users !== TOTAL_USERS ||
    !isObject(metadata.pools) ||
    metadata.pools.R !== POOLS.R.users ||
    metadata.pools.A !== POOLS.A.users ||
    metadata.pools.B !== POOLS.B.users
  ) {
    fail('fixture user distribution is invalid')
  }

  const timingValues = [
    metadata.generatedAt,
    metadata.loadedAt,
    metadata.earliestIssuedAt,
    metadata.latestIssuedAt,
    metadata.earliestExpiresAt,
    metadata.remainingTokenSeconds,
  ]

  if (
    metadata.tokenTtlSeconds !== TOKEN_TTL_SECONDS ||
    timingValues.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    fail('fixture token timing metadata is invalid')
  }

  if (
    metadata.earliestIssuedAt > metadata.latestIssuedAt ||
    metadata.latestIssuedAt > metadata.generatedAt ||
    metadata.generatedAt > metadata.loadedAt ||
    metadata.loadedAt >= metadata.earliestExpiresAt ||
    metadata.earliestExpiresAt - metadata.earliestIssuedAt !== TOKEN_TTL_SECONDS ||
    metadata.remainingTokenSeconds !== metadata.earliestExpiresAt - metadata.loadedAt ||
    metadata.remainingTokenSeconds < MINIMUM_REMAINING_TOKEN_SECONDS
  ) {
    fail('fixture token timeline is invalid')
  }

  if (
    !isObject(metadata.login) ||
    metadata.login.sequence !== DESIGNATED_LOGIN_SEQUENCE ||
    typeof metadata.login.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+$/.test(metadata.login.email)
  ) {
    fail('fixture login identity is invalid')
  }

  if (
    !isObject(metadata.dailyCharacter) ||
    !isPositiveInteger(metadata.dailyCharacter.id) ||
    typeof metadata.dailyCharacter.answer !== 'string' ||
    metadata.dailyCharacter.answer.length === 0
  ) {
    fail('fixture daily character is invalid')
  }

  if (metadata.tokensReturned !== false || metadata.secretsReturned !== false) {
    fail('fixture metadata has unsafe result flags')
  }

  return metadata
}

function validateDesignatedUser(user) {
  if (
    !isObject(user) ||
    user.sequence !== DESIGNATED_LOGIN_SEQUENCE ||
    user.pool !== 'R' ||
    !isPositiveInteger(user.userId) ||
    typeof user.token !== 'string' ||
    user.token.length === 0 ||
    /\s/.test(user.token) ||
    !Number.isInteger(user.issuedAt) ||
    !Number.isInteger(user.expiresAt) ||
    user.expiresAt - user.issuedAt !== TOKEN_TTL_SECONDS
  ) {
    fail('designated fixture user is invalid')
  }

  return user
}

function assertDesignatedUserMatchesFixture(metadata, user) {
  if (
    metadata.login.sequence !== user.sequence ||
    user.issuedAt < metadata.earliestIssuedAt ||
    user.issuedAt > metadata.latestIssuedAt ||
    user.issuedAt > metadata.generatedAt ||
    user.expiresAt < metadata.earliestExpiresAt
  ) {
    fail('designated user differs from fixture metadata')
  }
}

function validateApprovedTarget(target) {
  if (!hasExactKeys(target, APPROVED_TARGET_KEYS)) {
    fail('approved target has an invalid shape')
  }

  if (
    !isFingerprint(target.originFingerprint) ||
    !isPositiveInteger(target.taskDefinitionRevision) ||
    !isImageDigest(target.imageDigest) ||
    !isGitCommit(target.gitCommit)
  ) {
    fail('approved target identity is invalid')
  }

  return target
}

function validateObservedTarget(target) {
  if (!hasExactKeys(target, OBSERVED_TARGET_KEYS)) {
    fail('observed target has an invalid shape')
  }

  if (
    target.stage !== EXPECTED_STAGE ||
    target.region !== EXPECTED_REGION ||
    target.service !== EXPECTED_SERVICE
  ) {
    fail('observed service is not the approved staging service')
  }

  if (
    !isFingerprint(target.originFingerprint) ||
    !isPositiveInteger(target.taskDefinitionRevision) ||
    !isImageDigest(target.imageDigest) ||
    !isGitCommit(target.gitCommit)
  ) {
    fail('observed deployment identity is invalid')
  }

  if (
    target.deploymentStatus !== 'COMPLETED' ||
    target.desiredCount !== 1 ||
    target.runningCount !== 1 ||
    target.pendingCount !== 0
  ) {
    fail('staging deployment is not stable')
  }

  if (
    target.databaseHostFingerprint !== EXPECTED_DATABASE_HOST_FINGERPRINT ||
    target.database !== EXPECTED_DATABASE
  ) {
    fail('observed database is not the approved staging database')
  }

  return target
}

function assertTargetMatch(approved, observed) {
  for (const key of APPROVED_TARGET_KEYS) {
    if (approved[key] !== observed[key]) {
      fail('observed deployment differs from the approved target')
    }
  }
}

function validateClockWindow(nowSeconds) {
  const currentDate = utcDateFromUnixSeconds(nowSeconds)
  const secondsSinceMidnight = nowSeconds % SECONDS_PER_DAY
  const secondsUntilMidnight = SECONDS_PER_DAY - secondsSinceMidnight

  if (
    secondsSinceMidnight <= MIDNIGHT_GUARD_SECONDS ||
    secondsUntilMidnight <= MIDNIGHT_GUARD_SECONDS
  ) {
    fail('clock is inside the UTC midnight safety window')
  }

  return {
    currentDate,
    secondsSinceMidnight,
    secondsUntilMidnight,
  }
}

function validateTokenFreshness(metadata, designatedUser, nowSeconds) {
  if (nowSeconds < metadata.generatedAt || nowSeconds < metadata.loadedAt) {
    fail('clock precedes fixture generation or loading')
  }

  const remainingTokenSeconds = metadata.earliestExpiresAt - nowSeconds

  if (remainingTokenSeconds < MINIMUM_REMAINING_TOKEN_SECONDS) {
    fail('fixture tokens do not have enough remaining lifetime')
  }

  if (designatedUser.expiresAt - nowSeconds < MINIMUM_REMAINING_TOKEN_SECONDS) {
    fail('designated token does not have enough remaining lifetime')
  }

  return remainingTokenSeconds
}

function validateCanaryResult(result, expectedDefinition) {
  if (!hasExactKeys(result, CANARY_RESULT_KEYS)) {
    fail('canary result has an invalid shape')
  }

  if (
    result.canaryId !== expectedDefinition.canaryId ||
    result.scenarioId !== expectedDefinition.scenarioId
  ) {
    fail('canary results are missing, duplicated, or out of order')
  }

  if (
    result.credentialSource !== expectedDefinition.credentialSource ||
    result.userSequence !== expectedDefinition.userSequence
  ) {
    fail('canary credential evidence is invalid')
  }

  if (!isStrictDate(result.expectedDate) || !isFingerprint(result.originFingerprint)) {
    fail('canary target or date evidence is invalid')
  }

  if (
    (expectedDefinition.canaryId === 'health' && result.expectedUserId !== null) ||
    (expectedDefinition.canaryId !== 'health' && !isPositiveInteger(result.expectedUserId))
  ) {
    fail('canary expected-user evidence is invalid')
  }

  if (
    !Number.isInteger(result.status) ||
    (result.status !== 0 && (result.status < 100 || result.status > 599))
  ) {
    fail('canary result has an invalid status')
  }

  if (
    typeof result.passed !== 'boolean' ||
    typeof result.fixtureInvalidated !== 'boolean' ||
    result.secretsReturned !== false
  ) {
    fail('canary result has invalid safety flags')
  }

  if (result.databaseDateMatched !== null && typeof result.databaseDateMatched !== 'boolean') {
    fail('canary database-date result is invalid')
  }

  if (result.userIdMatched !== null && typeof result.userIdMatched !== 'boolean') {
    fail('canary user result is invalid')
  }

  if (
    result.category !== 'expected' &&
    result.category !== 'canary-failed' &&
    result.category !== 'fixture-invalidated'
  ) {
    fail('canary result category is invalid')
  }

  const fixtureShouldBeInvalidated =
    expectedDefinition.canaryId === 'protected' && result.status === 401

  if (
    result.fixtureInvalidated !== fixtureShouldBeInvalidated ||
    (result.category === 'fixture-invalidated') !== fixtureShouldBeInvalidated
  ) {
    fail('protected canary invalidation evidence is inconsistent')
  }

  return result
}

function validatePreCanaryContext({
  approvedTarget,
  observedTarget,
  fixtureMetadata,
  designatedUser,
  nowSeconds,
  databaseCurrentDate,
}) {
  const approved = validateApprovedTarget(approvedTarget)
  const observed = validateObservedTarget(observedTarget)

  assertTargetMatch(approved, observed)

  const metadata = validateFixtureShape(fixtureMetadata)
  const user = validateDesignatedUser(designatedUser)
  const clock = validateClockWindow(nowSeconds)

  assertDesignatedUserMatchesFixture(metadata, user)

  if (
    !isStrictDate(databaseCurrentDate) ||
    databaseCurrentDate !== clock.currentDate ||
    databaseCurrentDate !== metadata.source.seedDate
  ) {
    fail('database, fixture, and UTC dates do not match')
  }

  if (
    observed.databaseHostFingerprint !== metadata.source.hostFingerprint ||
    observed.database !== metadata.source.database
  ) {
    fail('fixture source differs from the observed database')
  }

  const remainingTokenSeconds = validateTokenFreshness(metadata, user, nowSeconds)

  return {
    approved,
    observed,
    metadata,
    user,
    clock,
    remainingTokenSeconds,
  }
}

function buildPreCanarySummary({
  observed,
  metadata,
  clock,
  remainingTokenSeconds,
  databaseCurrentDate,
}) {
  return Object.freeze({
    check: 'p2-pre-canary-ready',
    ready: true,
    target: Object.freeze({
      stage: observed.stage,
      region: observed.region,
      service: observed.service,
      taskDefinitionRevision: observed.taskDefinitionRevision,
      imageDigest: observed.imageDigest,
      gitCommit: observed.gitCommit,
      deploymentStatus: observed.deploymentStatus,
      desiredCount: observed.desiredCount,
      runningCount: observed.runningCount,
      pendingCount: observed.pendingCount,
    }),
    date: Object.freeze({
      databaseCurrentDate,
      fixtureSeedDate: metadata.source.seedDate,
      secondsSinceMidnight: clock.secondsSinceMidnight,
      secondsUntilMidnight: clock.secondsUntilMidnight,
      midnightGuardSeconds: MIDNIGHT_GUARD_SECONDS,
    }),
    fixture: Object.freeze({
      users: metadata.users,
      tokenTtlSeconds: metadata.tokenTtlSeconds,
      remainingTokenSeconds,
    }),
    canariesAuthorized: true,
    secretsReturned: false,
  })
}

export function buildP2PremeasurementCanaryPlan({
  baseUrl,
  approvedTarget,
  fixtureMetadata,
  designatedUser,
}) {
  const approved = validateApprovedTarget(approvedTarget)
  let normalizedOrigin

  try {
    normalizedOrigin = normalizeScenarioHttpsOrigin(baseUrl)
  } catch {
    fail('canary target origin is invalid')
  }

  if (
    normalizedOrigin !== baseUrl ||
    fingerprintOrigin(normalizedOrigin) !== approved.originFingerprint
  ) {
    fail('canary target origin differs from the approved target')
  }

  const metadata = validateFixtureShape(fixtureMetadata)
  const user = validateDesignatedUser(designatedUser)

  assertDesignatedUserMatchesFixture(metadata, user)

  return Object.freeze({
    check: 'p2-premeasurement-canary-plan',
    canaries: Object.freeze(
      CANARY_DEFINITIONS.map((definition) =>
        Object.freeze({
          ...definition,
        }),
      ),
    ),
    secretsReturned: false,
  })
}

export function classifyP2PremeasurementCanary({
  canaryId,
  status,
  body,
  expectedUserId,
  expectedDate,
  originFingerprint,
  credentialSource,
  userSequence,
}) {
  const definition = CANARY_DEFINITIONS.find((candidate) => candidate.canaryId === canaryId)

  if (!definition) {
    fail('canary ID is not approved')
  }

  if (
    credentialSource !== definition.credentialSource ||
    userSequence !== definition.userSequence
  ) {
    fail('canary credential evidence is invalid')
  }

  if (!Number.isInteger(status) || (status !== 0 && (status < 100 || status > 599))) {
    fail('canary HTTP status is invalid')
  }

  if (!isStrictDate(expectedDate)) {
    fail('canary expected date is invalid')
  }

  if (!isFingerprint(originFingerprint)) {
    fail('canary target fingerprint is invalid')
  }

  if (canaryId !== 'health' && !isPositiveInteger(expectedUserId)) {
    fail('canary expected user is invalid')
  }

  if (canaryId === 'health' && expectedUserId !== null) {
    fail('health canary must not select a user')
  }

  let classification

  try {
    classification = classifyScenarioResponse({
      scenarioId: definition.scenarioId,
      status,
      body,
    })
  } catch {
    fail('canary response classification failed')
  }

  let databaseDateMatched = null
  let userIdMatched = null

  if (canaryId === 'health') {
    databaseDateMatched = utcDateFromTimestamp(body?.time) === expectedDate
  }

  if (canaryId === 'login') {
    userIdMatched = isObject(body?.user) && body.user.id === expectedUserId
  }

  if (canaryId === 'protected') {
    userIdMatched = isObject(body) && body.id === expectedUserId
  }

  const fixtureInvalidated = canaryId === 'protected' && status === 401

  const additionalContractPassed = canaryId === 'health' ? databaseDateMatched : userIdMatched

  const passed = classification.expected === true && additionalContractPassed === true

  return Object.freeze({
    canaryId: definition.canaryId,
    scenarioId: definition.scenarioId,
    credentialSource: definition.credentialSource,
    userSequence: definition.userSequence,
    expectedDate,
    expectedUserId,
    originFingerprint,
    status,
    passed,
    category: fixtureInvalidated ? 'fixture-invalidated' : passed ? 'expected' : 'canary-failed',
    databaseDateMatched,
    userIdMatched,
    fixtureInvalidated,
    secretsReturned: false,
  })
}

export function assertP2PreCanaryReady({
  approvedTarget,
  observedTarget,
  fixtureMetadata,
  designatedUser,
  nowSeconds,
  databaseCurrentDate,
}) {
  const context = validatePreCanaryContext({
    approvedTarget,
    observedTarget,
    fixtureMetadata,
    designatedUser,
    nowSeconds,
    databaseCurrentDate,
  })

  return buildPreCanarySummary({
    ...context,
    databaseCurrentDate,
  })
}

export function assertP2PremeasurementReady({
  approvedTarget,
  observedTarget,
  fixtureMetadata,
  designatedUser,
  nowSeconds,
  databaseCurrentDate,
  canaries,
}) {
  const { approved, observed, metadata, user, clock, remainingTokenSeconds } =
    validatePreCanaryContext({
      approvedTarget,
      observedTarget,
      fixtureMetadata,
      designatedUser,
      nowSeconds,
      databaseCurrentDate,
    })

  if (!Array.isArray(canaries) || canaries.length !== CANARY_DEFINITIONS.length) {
    fail('exactly three canary results are required')
  }

  const validatedCanaries = canaries.map((result, index) =>
    validateCanaryResult(result, CANARY_DEFINITIONS[index]),
  )

  if (
    validatedCanaries.some(
      (result) =>
        result.originFingerprint !== approved.originFingerprint ||
        result.expectedDate !== databaseCurrentDate,
    ) ||
    validatedCanaries[0].expectedUserId !== null ||
    validatedCanaries[1].expectedUserId !== user.userId ||
    validatedCanaries[2].expectedUserId !== user.userId
  ) {
    fail('canary evidence is not bound to the approved target, date, and user')
  }

  if (validatedCanaries.some((result) => result.fixtureInvalidated)) {
    fail('fixture token was invalidated by the protected canary')
  }

  if (
    validatedCanaries.some(
      (result) => result.passed !== true || result.category !== 'expected' || result.status !== 200,
    )
  ) {
    fail('one or more premeasurement canaries failed')
  }

  if (
    validatedCanaries[0].databaseDateMatched !== true ||
    validatedCanaries[0].userIdMatched !== null ||
    validatedCanaries[1].databaseDateMatched !== null ||
    validatedCanaries[1].userIdMatched !== true ||
    validatedCanaries[2].databaseDateMatched !== null ||
    validatedCanaries[2].userIdMatched !== true
  ) {
    fail('canary evidence does not match its approved purpose')
  }

  return Object.freeze({
    check: 'p2-premeasurement-ready',
    ready: true,
    target: Object.freeze({
      stage: observed.stage,
      region: observed.region,
      service: observed.service,
      taskDefinitionRevision: observed.taskDefinitionRevision,
      imageDigest: observed.imageDigest,
      gitCommit: observed.gitCommit,
      deploymentStatus: observed.deploymentStatus,
      desiredCount: observed.desiredCount,
      runningCount: observed.runningCount,
      pendingCount: observed.pendingCount,
    }),
    date: Object.freeze({
      databaseCurrentDate,
      fixtureSeedDate: metadata.source.seedDate,
      secondsSinceMidnight: clock.secondsSinceMidnight,
      secondsUntilMidnight: clock.secondsUntilMidnight,
      midnightGuardSeconds: MIDNIGHT_GUARD_SECONDS,
    }),
    fixture: Object.freeze({
      users: metadata.users,
      tokenTtlSeconds: metadata.tokenTtlSeconds,
      remainingTokenSeconds,
    }),
    canaries: Object.freeze(
      validatedCanaries.map((result) =>
        Object.freeze({
          canaryId: result.canaryId,
          status: result.status,
          passed: result.passed,
          fixtureInvalidated: result.fixtureInvalidated,
        }),
      ),
    ),
    fixtureInvalidated: false,
    secretsReturned: false,
  })
}
