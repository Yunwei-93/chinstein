import { TOTAL_USERS } from '../../fixture-config.mjs'

import {
  MINIMUM_REMAINING_TOKEN_SECONDS,
  TOKEN_TTL_SECONDS,
  validateTokenFixture,
} from '../token-fixture-contracts.mjs'

const METADATA_RECORD_TYPE = 'p2-token-fixture-metadata'

function fail(message) {
  throw new Error(`Invalid k6 token fixture: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateClock(nowSeconds) {
  if (typeof nowSeconds !== 'function') {
    fail('clock function is unavailable')
  }

  const currentTime = nowSeconds()

  if (!Number.isInteger(currentTime)) {
    fail('clock did not return whole Unix seconds')
  }

  return currentTime
}

function parseFixture(serializedFixture) {
  if (typeof serializedFixture !== 'string' || serializedFixture.length === 0) {
    fail('serialized fixture is unavailable')
  }

  try {
    return JSON.parse(serializedFixture)
  } catch {
    fail('serialized fixture is not valid JSON')
  }
}

function inspectTokenTimes(users) {
  let earliestIssuedAt = Number.POSITIVE_INFINITY
  let latestIssuedAt = Number.NEGATIVE_INFINITY
  let earliestExpiresAt = Number.POSITIVE_INFINITY

  for (const user of users) {
    earliestIssuedAt = Math.min(earliestIssuedAt, user.issuedAt)

    latestIssuedAt = Math.max(latestIssuedAt, user.issuedAt)

    earliestExpiresAt = Math.min(earliestExpiresAt, user.expiresAt)
  }

  return {
    earliestIssuedAt,
    latestIssuedAt,
    earliestExpiresAt,
  }
}

export function buildSharedTokenFixtureRecords(
  serializedFixture,
  { nowSeconds = () => Math.floor(Date.now() / 1000) } = {},
) {
  const currentTime = validateClock(nowSeconds)
  const fixture = parseFixture(serializedFixture)
  const summary = validateTokenFixture(fixture)
  const tokenTimes = inspectTokenTimes(fixture.users)

  if (currentTime < fixture.generatedAt) {
    fail('load-generator clock precedes fixture generation')
  }

  const remainingTokenSeconds = tokenTimes.earliestExpiresAt - currentTime

  if (remainingTokenSeconds < MINIMUM_REMAINING_TOKEN_SECONDS) {
    fail('tokens do not have enough lifetime at k6 startup')
  }

  const metadata = {
    type: METADATA_RECORD_TYPE,
    schemaVersion: summary.schemaVersion,
    generatedAt: fixture.generatedAt,
    loadedAt: currentTime,
    source: {
      hostFingerprint: fixture.source.hostFingerprint,
      database: fixture.source.database,
      seedDate: fixture.source.seedDate,
    },
    dailyCharacter: {
      id: fixture.dailyCharacter.id,
      answer: fixture.dailyCharacter.answer,
    },
    login: {
      sequence: fixture.login.sequence,
      email: fixture.login.email,
    },
    users: summary.users,
    pools: {
      ...summary.pools,
    },
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    earliestIssuedAt: tokenTimes.earliestIssuedAt,
    latestIssuedAt: tokenTimes.latestIssuedAt,
    earliestExpiresAt: tokenTimes.earliestExpiresAt,
    remainingTokenSeconds,
    tokensReturned: false,
    secretsReturned: false,
  }

  return [metadata, ...fixture.users]
}

function validateSharedRecords(records) {
  if (records === null || typeof records !== 'object' || records.length !== TOTAL_USERS + 1) {
    fail('shared fixture has the wrong record count')
  }
}

export function readSharedTokenFixtureMetadata(records) {
  validateSharedRecords(records)

  const metadata = records[0]

  if (
    !isObject(metadata) ||
    metadata.type !== METADATA_RECORD_TYPE ||
    metadata.users !== TOTAL_USERS ||
    metadata.tokenTtlSeconds !== TOKEN_TTL_SECONDS ||
    metadata.tokensReturned !== false ||
    metadata.secretsReturned !== false
  ) {
    fail('shared fixture metadata is invalid')
  }

  return metadata
}

export function readSharedTokenUser(records, sequence, expectedPool = null) {
  validateSharedRecords(records)

  if (!Number.isInteger(sequence) || sequence < 1 || sequence > TOTAL_USERS) {
    fail('requested user sequence is outside the fixture')
  }

  const user = records[sequence]

  if (
    !isObject(user) ||
    user.sequence !== sequence ||
    !Number.isInteger(user.userId) ||
    user.userId <= 0 ||
    typeof user.pool !== 'string' ||
    typeof user.token !== 'string' ||
    user.token.length === 0 ||
    !Number.isInteger(user.issuedAt) ||
    !Number.isInteger(user.expiresAt)
  ) {
    fail(`shared user ${sequence} is invalid`)
  }

  if (expectedPool !== null && user.pool !== expectedPool) {
    fail(`shared user ${sequence} is outside the expected pool`)
  }

  return user
}
