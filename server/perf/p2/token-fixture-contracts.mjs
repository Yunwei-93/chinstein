import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'

export const TOKEN_FIXTURE_SCHEMA_VERSION = 1
export const TOKEN_TTL_SECONDS = 4 * 60 * 60
export const MINIMUM_REMAINING_TOKEN_SECONDS = 3 * 60 * 60
export const DESIGNATED_LOGIN_SEQUENCE = POOLS.R.firstSeq

const FORBIDDEN_FIXTURE_KEYS = new Set([
  'password',
  'passwordhash',
  'jwtsecret',
  'databaseurl',
  'connectionstring',
  'postgresurl',
])

function fail(message) {
  throw new Error(`Invalid PERF token fixture: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function normalizeKey(key) {
  return key.replaceAll('_', '').replaceAll('-', '').toLowerCase()
}

function findForbiddenKey(value, path = '$') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findForbiddenKey(item, `${path}[${index}]`)

      if (result) {
        return result
      }
    }

    return null
  }

  if (!isObject(value)) {
    return null
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIXTURE_KEYS.has(normalizeKey(key))) {
      return `${path}.${key}`
    }

    const result = findForbiddenKey(child, `${path}.${key}`)

    if (result) {
      return result
    }
  }

  return null
}

export function poolForSequence(sequence) {
  if (!Number.isInteger(sequence)) {
    fail('user sequence must be an integer')
  }

  for (const [poolName, pool] of Object.entries(POOLS)) {
    if (sequence >= pool.firstSeq && sequence <= pool.lastSeq) {
      return poolName
    }
  }

  fail(`user sequence ${sequence} is outside every pool`)
}

function validateSource(source) {
  if (!isObject(source)) {
    fail('source identity is missing')
  }

  if (
    typeof source.hostFingerprint !== 'string' ||
    !/^[a-f0-9]{12}$/.test(source.hostFingerprint)
  ) {
    fail('source host fingerprint is invalid')
  }

  if (source.database !== 'neondb') {
    fail('source database is not neondb')
  }

  if (typeof source.seedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.seedDate)) {
    fail('source seed date is invalid')
  }
}

function validateDailyCharacter(dailyCharacter) {
  if (!isObject(dailyCharacter)) {
    fail('daily-character fixture is missing')
  }

  if (!isPositiveInteger(dailyCharacter.id)) {
    fail('daily-character ID is invalid')
  }

  if (typeof dailyCharacter.answer !== 'string' || dailyCharacter.answer.length === 0) {
    fail('daily-character answer is invalid')
  }
}

function validateLoginIdentity(login) {
  if (!isObject(login)) {
    fail('login identity is missing')
  }

  if (login.sequence !== DESIGNATED_LOGIN_SEQUENCE) {
    fail('login identity is not the designated Pool R user')
  }

  if (typeof login.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(login.email)) {
    fail('login email is invalid')
  }

  if (hasOwn(login, 'password')) {
    fail('login password must not be stored in the token fixture')
  }
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function validateTokenRecord(record, expectedSequence, userIds, tokenValues, poolCounts) {
  if (!isObject(record)) {
    fail(`user ${expectedSequence} is not an object`)
  }

  if (record.sequence !== expectedSequence) {
    fail(`expected user sequence ${expectedSequence}, received ${record.sequence}`)
  }

  if (!isPositiveInteger(record.userId)) {
    fail(`user ${expectedSequence} has an invalid user ID`)
  }

  if (userIds.has(record.userId)) {
    fail(`user ${expectedSequence} repeats a user ID`)
  }

  userIds.add(record.userId)

  const expectedPool = poolForSequence(expectedSequence)

  if (record.pool !== expectedPool) {
    fail(`user ${expectedSequence} has the wrong pool`)
  }

  poolCounts[expectedPool] += 1

  if (typeof record.token !== 'string' || record.token.length === 0) {
    fail(`user ${expectedSequence} has no token`)
  }

  if (tokenValues.has(record.token)) {
    fail(`user ${expectedSequence} repeats a token`)
  }

  tokenValues.add(record.token)

  if (!Number.isInteger(record.issuedAt) || !Number.isInteger(record.expiresAt)) {
    fail(`user ${expectedSequence} has invalid token timestamps`)
  }

  if (record.expiresAt - record.issuedAt !== TOKEN_TTL_SECONDS) {
    fail(`user ${expectedSequence} does not have a four-hour token`)
  }
}

export function validateTokenFixture(fixture) {
  if (!isObject(fixture)) {
    fail('fixture root is not an object')
  }

  const forbiddenPath = findForbiddenKey(fixture)

  if (forbiddenPath) {
    fail(`forbidden secret field found at ${forbiddenPath}`)
  }

  if (fixture.schemaVersion !== TOKEN_FIXTURE_SCHEMA_VERSION) {
    fail('schema version is not supported')
  }

  if (!Number.isInteger(fixture.generatedAt)) {
    fail('generatedAt must be Unix time in whole seconds')
  }

  validateSource(fixture.source)
  validateDailyCharacter(fixture.dailyCharacter)
  validateLoginIdentity(fixture.login)

  if (!Array.isArray(fixture.users) || fixture.users.length !== TOTAL_USERS) {
    fail(`fixture must contain exactly ${TOTAL_USERS} users`)
  }

  const userIds = new Set()
  const tokenValues = new Set()

  const poolCounts = {
    R: 0,
    A: 0,
    B: 0,
  }

  let earliestIssuedAt = Number.POSITIVE_INFINITY
  let latestIssuedAt = Number.NEGATIVE_INFINITY
  let earliestExpiresAt = Number.POSITIVE_INFINITY

  for (const [index, record] of fixture.users.entries()) {
    const expectedSequence = index + 1

    validateTokenRecord(record, expectedSequence, userIds, tokenValues, poolCounts)

    earliestIssuedAt = Math.min(earliestIssuedAt, record.issuedAt)

    latestIssuedAt = Math.max(latestIssuedAt, record.issuedAt)

    earliestExpiresAt = Math.min(earliestExpiresAt, record.expiresAt)
  }

  for (const [poolName, pool] of Object.entries(POOLS)) {
    if (poolCounts[poolName] !== pool.users) {
      fail(`Pool ${poolName} has the wrong user count`)
    }
  }

  if (fixture.generatedAt < latestIssuedAt) {
    fail('generatedAt precedes the final token issue time')
  }

  if (fixture.generatedAt >= earliestExpiresAt) {
    fail('one or more tokens are already expired')
  }

  const remainingTokenSeconds = earliestExpiresAt - fixture.generatedAt

  if (remainingTokenSeconds < MINIMUM_REMAINING_TOKEN_SECONDS) {
    fail('tokens do not have enough remaining lifetime')
  }

  return {
    schemaVersion: fixture.schemaVersion,
    users: fixture.users.length,
    pools: poolCounts,
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    tokenIssueSpreadSeconds: latestIssuedAt - earliestIssuedAt,
    remainingTokenSeconds,
    sourceSeedDate: fixture.source.seedDate,
    loginSequence: fixture.login.sequence,
    tokensReturned: false,
    loginPasswordStored: false,
  }
}
