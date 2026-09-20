import assert from 'node:assert/strict'
import test from 'node:test'

import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'

import {
  DESIGNATED_LOGIN_SEQUENCE,
  MINIMUM_REMAINING_TOKEN_SECONDS,
  TOKEN_FIXTURE_SCHEMA_VERSION,
  TOKEN_TTL_SECONDS,
  poolForSequence,
  validateTokenFixture,
} from './token-fixture-contracts.mjs'

const BASE_ISSUED_AT = 1_800_000_000

function buildValidFixture() {
  const users = Array.from({ length: TOTAL_USERS }, (_, index) => {
    const sequence = index + 1
    const issuedAt = BASE_ISSUED_AT + (sequence % 3)

    return {
      sequence,
      userId: 10_000 + sequence,
      pool: poolForSequence(sequence),
      token: `synthetic-token-${sequence}`,
      issuedAt,
      expiresAt: issuedAt + TOKEN_TTL_SECONDS,
    }
  })

  return {
    schemaVersion: TOKEN_FIXTURE_SCHEMA_VERSION,
    generatedAt: BASE_ISSUED_AT + 3,
    source: {
      hostFingerprint: '0123456789ab',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    dailyCharacter: {
      id: 10,
      answer: 'known-answer',
    },
    login: {
      sequence: DESIGNATED_LOGIN_SEQUENCE,
      email: 'player_00001@example.invalid',
    },
    users,
  }
}

test('the valid token fixture contains every approved user', () => {
  const fixture = buildValidFixture()
  const summary = validateTokenFixture(fixture)

  assert.deepEqual(summary, {
    schemaVersion: 1,
    users: 8100,
    pools: {
      R: POOLS.R.users,
      A: POOLS.A.users,
      B: POOLS.B.users,
    },
    tokenTtlSeconds: 14_400,
    tokenIssueSpreadSeconds: 2,
    remainingTokenSeconds: 14_397,
    sourceSeedDate: '2026-09-18',
    loginSequence: 1,
    tokensReturned: false,
    loginPasswordStored: false,
  })
})

test('pool boundaries match the frozen user ranges', () => {
  assert.equal(poolForSequence(1), 'R')
  assert.equal(poolForSequence(900), 'R')
  assert.equal(poolForSequence(901), 'A')
  assert.equal(poolForSequence(7900), 'A')
  assert.equal(poolForSequence(7901), 'B')
  assert.equal(poolForSequence(8100), 'B')

  assert.throws(() => poolForSequence(0), /outside every pool/)

  assert.throws(() => poolForSequence(8101), /outside every pool/)
})

test('the fixture rejects a missing user', () => {
  const fixture = buildValidFixture()
  fixture.users.pop()

  assert.throws(() => validateTokenFixture(fixture), /exactly 8100 users/)
})

test('the fixture rejects duplicate database user IDs', () => {
  const fixture = buildValidFixture()

  fixture.users[1].userId = fixture.users[0].userId

  assert.throws(() => validateTokenFixture(fixture), /repeats a user ID/)
})

test('the fixture rejects duplicate token values', () => {
  const fixture = buildValidFixture()

  fixture.users[1].token = fixture.users[0].token

  assert.throws(() => validateTokenFixture(fixture), /repeats a token/)
})

test('the fixture rejects an incorrect pool assignment', () => {
  const fixture = buildValidFixture()
  fixture.users[900].pool = 'R'

  assert.throws(() => validateTokenFixture(fixture), /wrong pool/)
})

test('the fixture rejects a token with the wrong lifetime', () => {
  const fixture = buildValidFixture()
  fixture.users[0].expiresAt -= 1

  assert.throws(() => validateTokenFixture(fixture), /does not have a four-hour token/)
})

test('the fixture rejects insufficient remaining lifetime', () => {
  const fixture = buildValidFixture()

  fixture.generatedAt = BASE_ISSUED_AT + TOKEN_TTL_SECONDS - MINIMUM_REMAINING_TOKEN_SECONDS + 1

  assert.throws(() => validateTokenFixture(fixture), /not have enough remaining lifetime/)
})

test('the fixture rejects a stored login password', () => {
  const fixture = buildValidFixture()
  fixture.login.password = 'must-not-be-stored'

  assert.throws(() => validateTokenFixture(fixture), /forbidden secret field/)
})

test('the fixture rejects a database connection field', () => {
  const fixture = buildValidFixture()

  fixture.source.databaseUrl = 'value-must-not-be-stored'

  assert.throws(() => validateTokenFixture(fixture), /forbidden secret field/)
})

test('the validation summary never returns token values', () => {
  const fixture = buildValidFixture()
  const summary = validateTokenFixture(fixture)

  assert.equal(JSON.stringify(summary).includes(fixture.users[0].token), false)
})
