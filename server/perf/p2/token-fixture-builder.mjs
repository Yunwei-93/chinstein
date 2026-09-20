import { TOTAL_USERS } from '../fixture-config.mjs'

import {
  DESIGNATED_LOGIN_SEQUENCE,
  TOKEN_TTL_SECONDS,
  validateTokenFixture,
} from './token-fixture-contracts.mjs'

function fail(message) {
  throw new Error(`Unable to build PERF token fixture: ${message}`)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateUserRows(users) {
  if (!Array.isArray(users) || users.length !== TOTAL_USERS) {
    fail(`expected exactly ${TOTAL_USERS} mapped users`)
  }

  for (const [index, user] of users.entries()) {
    const expectedSequence = index + 1

    if (user.sequence !== expectedSequence) {
      fail(`expected user sequence ${expectedSequence}, received ${user.sequence}`)
    }

    if (!isPositiveInteger(user.userId)) {
      fail(`user ${expectedSequence} has an invalid database ID`)
    }
  }

  const loginUser = users[DESIGNATED_LOGIN_SEQUENCE - 1]

  if (typeof loginUser.email !== 'string' || loginUser.email.length === 0) {
    fail('the designated login user has no email')
  }

  return loginUser
}

function validateVerifiedToken(verified, expectedUserId, sequence) {
  if (
    verified === null ||
    typeof verified !== 'object' ||
    verified.header === null ||
    typeof verified.header !== 'object' ||
    verified.payload === null ||
    typeof verified.payload !== 'object'
  ) {
    fail(`user ${sequence} token could not be verified`)
  }

  if (verified.header.alg !== 'HS256') {
    fail(`user ${sequence} token does not use HS256`)
  }

  if (verified.payload.userId !== expectedUserId) {
    fail(`user ${sequence} token has the wrong user ID`)
  }

  if (!Number.isInteger(verified.payload.iat) || !Number.isInteger(verified.payload.exp)) {
    fail(`user ${sequence} token has invalid timestamps`)
  }

  if (verified.payload.exp - verified.payload.iat !== TOKEN_TTL_SECONDS) {
    fail(`user ${sequence} token is not valid for four hours`)
  }

  return {
    issuedAt: verified.payload.iat,
    expiresAt: verified.payload.exp,
  }
}

export function buildTokenFixture({
  users,
  source,
  dailyCharacter,
  signTokenForUser,
  verifySignedToken,
  nowSeconds = () => Math.floor(Date.now() / 1000),
}) {
  if (typeof signTokenForUser !== 'function') {
    fail('token signer is missing')
  }

  if (typeof verifySignedToken !== 'function') {
    fail('token verifier is missing')
  }

  if (typeof nowSeconds !== 'function') {
    fail('clock function is missing')
  }

  const loginUser = validateUserRows(users)
  const tokenRecords = []

  for (const user of users) {
    const token = signTokenForUser(user.userId)

    if (typeof token !== 'string' || token.length === 0) {
      fail(`user ${user.sequence} signer returned no token`)
    }

    const verified = verifySignedToken(token)

    const timestamps = validateVerifiedToken(verified, user.userId, user.sequence)

    tokenRecords.push({
      sequence: user.sequence,
      userId: user.userId,
      pool: user.pool,
      token,
      issuedAt: timestamps.issuedAt,
      expiresAt: timestamps.expiresAt,
    })
  }

  const generatedAt = nowSeconds()

  if (!Number.isInteger(generatedAt)) {
    fail('clock did not return whole Unix seconds')
  }

  const fixture = {
    schemaVersion: 1,
    generatedAt,
    source: {
      hostFingerprint: source?.hostFingerprint,
      database: source?.database,
      seedDate: source?.seedDate,
    },
    dailyCharacter: {
      id: dailyCharacter?.id,
      answer: dailyCharacter?.answer,
    },
    login: {
      sequence: DESIGNATED_LOGIN_SEQUENCE,
      email: loginUser.email,
    },
    users: tokenRecords,
  }

  const summary = validateTokenFixture(fixture)

  return {
    fixture,
    summary,
  }
}
