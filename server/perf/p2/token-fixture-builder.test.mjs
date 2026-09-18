import assert from 'node:assert/strict'
import test from 'node:test'

import { TOTAL_USERS } from '../fixture-config.mjs'

import { TOKEN_TTL_SECONDS, poolForSequence } from './token-fixture-contracts.mjs'

import { buildTokenFixture } from './token-fixture-builder.mjs'

const BASE_ISSUED_AT = 1_800_000_000

function buildMappedUsers() {
  return Array.from({ length: TOTAL_USERS }, (_, index) => {
    const sequence = index + 1

    return {
      sequence,
      userId: 10_000 + sequence,
      pool: poolForSequence(sequence),
      email: sequence === 1 ? 'player_00001@example.invalid' : undefined,
    }
  })
}

function signFakeToken(userId) {
  return `synthetic-token-${userId}`
}

function verifyFakeToken(token) {
  const userId = Number(token.replace('synthetic-token-', ''))

  const issuedAt = BASE_ISSUED_AT + (userId % 3)

  return {
    header: {
      alg: 'HS256',
    },
    payload: {
      userId,
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
    },
  }
}

function buildFixture(overrides = {}) {
  return buildTokenFixture({
    users: buildMappedUsers(),
    source: {
      hostFingerprint: '0123456789ab',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    dailyCharacter: {
      id: 10,
      answer: 'known-answer',
    },
    signTokenForUser: signFakeToken,
    verifySignedToken: verifyFakeToken,
    nowSeconds: () => BASE_ISSUED_AT + 3,
    ...overrides,
  })
}

test('builder creates a complete validated fixture', () => {
  const result = buildFixture()

  assert.equal(result.fixture.users.length, 8100)
  assert.equal(result.fixture.users[0].sequence, 1)
  assert.equal(result.fixture.users.at(-1).sequence, 8100)

  assert.equal(result.fixture.login.email, 'player_00001@example.invalid')

  assert.deepEqual(result.summary.pools, {
    R: 900,
    A: 7000,
    B: 200,
  })

  assert.equal(result.summary.tokenTtlSeconds, 14_400)

  assert.equal(result.summary.tokensReturned, false)
  assert.equal(result.summary.loginPasswordStored, false)
})

test('builder returns tokens only in the private fixture', () => {
  const result = buildFixture()
  const firstToken = result.fixture.users[0].token

  assert.equal(JSON.stringify(result.summary).includes(firstToken), false)

  assert.equal(firstToken, 'synthetic-token-10001')
})

test('builder rejects a token using the wrong algorithm', () => {
  assert.throws(
    () =>
      buildFixture({
        verifySignedToken(token) {
          const verified = verifyFakeToken(token)

          return {
            ...verified,
            header: {
              alg: 'RS256',
            },
          }
        },
      }),
    /does not use HS256/,
  )
})

test('builder rejects a token for the wrong user', () => {
  assert.throws(
    () =>
      buildFixture({
        verifySignedToken(token) {
          const verified = verifyFakeToken(token)

          return {
            ...verified,
            payload: {
              ...verified.payload,
              userId: verified.payload.userId + 1,
            },
          }
        },
      }),
    /wrong user ID/,
  )
})

test('builder rejects a token with the wrong TTL', () => {
  assert.throws(
    () =>
      buildFixture({
        verifySignedToken(token) {
          const verified = verifyFakeToken(token)

          return {
            ...verified,
            payload: {
              ...verified.payload,
              exp: verified.payload.exp - 1,
            },
          }
        },
      }),
    /not valid for four hours/,
  )
})

test('builder rejects missing mapped users', () => {
  const users = buildMappedUsers()
  users.pop()

  assert.throws(
    () =>
      buildFixture({
        users,
      }),
    /expected exactly 8100 mapped users/,
  )
})

test('builder rejects users in the wrong sequence order', () => {
  const users = buildMappedUsers()

  ;[users[0], users[1]] = [users[1], users[0]]

  assert.throws(
    () =>
      buildFixture({
        users,
      }),
    /expected user sequence 1/,
  )
})

test('builder rejects a missing signer', () => {
  assert.throws(
    () =>
      buildFixture({
        signTokenForUser: null,
      }),
    /token signer is missing/,
  )
})

test('builder rejects a missing verifier', () => {
  assert.throws(
    () =>
      buildFixture({
        verifySignedToken: null,
      }),
    /token verifier is missing/,
  )
})

test('builder rejects an unapproved source identity', () => {
  assert.throws(
    () =>
      buildFixture({
        source: {
          hostFingerprint: 'not-approved',
          database: 'neondb',
          seedDate: '2026-09-18',
        },
      }),
    /source host fingerprint is invalid/,
  )
})
