import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'

import {
  buildSharedTokenFixtureRecords,
  readSharedTokenFixtureMetadata,
  readSharedTokenUser,
} from './k6/k6-token-fixture-contracts.mjs'
import { MINIMUM_REMAINING_TOKEN_SECONDS, TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'

const GENERATED_AT = 2_000_000_000
const PRIVATE_JSON_VALUE = 'private-json-value-marker'

function poolForSequence(sequence) {
  for (const [poolName, pool] of Object.entries(POOLS)) {
    if (sequence >= pool.firstSeq && sequence <= pool.lastSeq) {
      return poolName
    }
  }

  throw new Error(`Unexpected sequence: ${sequence}`)
}

function createValidFixture() {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    source: {
      hostFingerprint: '777c6ca41572',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    dailyCharacter: {
      id: 274,
      answer: 'synthetic-answer',
    },
    login: {
      sequence: POOLS.R.firstSeq,
      email: 'player_00001@example.invalid',
    },
    users: Array.from({ length: TOTAL_USERS }, (_, index) => {
      const sequence = index + 1

      return {
        sequence,
        userId: 100_000 + sequence,
        pool: poolForSequence(sequence),
        token: `fixture-token-${sequence}`,
        issuedAt: GENERATED_AT,
        expiresAt: GENERATED_AT + TOKEN_TTL_SECONDS,
      }
    }),
  }
}

function serializeValidFixture() {
  return JSON.stringify(createValidFixture())
}

function buildRecords(nowSeconds = GENERATED_AT + 60) {
  return buildSharedTokenFixtureRecords(serializeValidFixture(), {
    nowSeconds: () => nowSeconds,
  })
}

test('builds one metadata record followed by all token users', () => {
  const records = buildRecords()

  assert.equal(records.length, TOTAL_USERS + 1)

  const metadata = readSharedTokenFixtureMetadata(records)

  assert.deepEqual(metadata.source, {
    hostFingerprint: '777c6ca41572',
    database: 'neondb',
    seedDate: '2026-09-18',
  })

  assert.deepEqual(metadata.dailyCharacter, {
    id: 274,
    answer: 'synthetic-answer',
  })

  assert.deepEqual(metadata.login, {
    sequence: POOLS.R.firstSeq,
    email: 'player_00001@example.invalid',
  })

  assert.equal(metadata.users, TOTAL_USERS)
  assert.equal(metadata.tokenTtlSeconds, TOKEN_TTL_SECONDS)

  assert.equal(metadata.remainingTokenSeconds, TOKEN_TTL_SECONDS - 60)

  assert.equal(JSON.stringify(metadata).includes('fixture-token'), false)
})

test('selects users directly by sequence and enforces pool ownership', () => {
  const records = buildRecords()

  const poolRUser = readSharedTokenUser(records, POOLS.R.firstSeq, 'R')

  const poolAUser = readSharedTokenUser(records, POOLS.A.firstSeq, 'A')

  const poolBUser = readSharedTokenUser(records, POOLS.B.firstSeq, 'B')

  assert.equal(poolRUser.sequence, POOLS.R.firstSeq)
  assert.equal(poolAUser.sequence, POOLS.A.firstSeq)
  assert.equal(poolBUser.sequence, POOLS.B.firstSeq)

  assert.throws(
    () => readSharedTokenUser(records, POOLS.A.firstSeq, 'B'),
    /outside the expected pool/,
  )

  assert.throws(() => readSharedTokenUser(records, 0), /outside the fixture/)

  assert.throws(() => readSharedTokenUser(records, TOTAL_USERS + 1), /outside the fixture/)
})

test('rejects invalid JSON without exposing its content', () => {
  const serializedFixture = `{"private":"${PRIVATE_JSON_VALUE}"`

  assert.throws(
    () =>
      buildSharedTokenFixtureRecords(serializedFixture, {
        nowSeconds: () => GENERATED_AT,
      }),
    (error) => {
      assert.match(error.message, /not valid JSON/)

      assert.equal(error.message.includes(PRIVATE_JSON_VALUE), false)

      return true
    },
  )
})

test('rejects invalid and backward load-generator clocks', () => {
  const serializedFixture = serializeValidFixture()

  assert.throws(
    () =>
      buildSharedTokenFixtureRecords(serializedFixture, {
        nowSeconds: null,
      }),
    /clock function is unavailable/,
  )

  assert.throws(
    () =>
      buildSharedTokenFixtureRecords(serializedFixture, {
        nowSeconds: () => 1.5,
      }),
    /whole Unix seconds/,
  )

  assert.throws(
    () =>
      buildSharedTokenFixtureRecords(serializedFixture, {
        nowSeconds: () => GENERATED_AT - 1,
      }),
    /clock precedes fixture generation/,
  )
})

test('rejects tokens without enough lifetime at k6 startup', () => {
  const unsafeLoadTime = GENERATED_AT + TOKEN_TTL_SECONDS - MINIMUM_REMAINING_TOKEN_SECONDS + 1

  assert.throws(() => buildRecords(unsafeLoadTime), /do not have enough lifetime/)
})

test('rejects malformed shared metadata and user records', () => {
  const records = buildRecords()

  assert.throws(() => readSharedTokenFixtureMetadata(records.slice(0, -1)), /wrong record count/)

  const invalidMetadataRecords = [...records]

  invalidMetadataRecords[0] = {
    ...invalidMetadataRecords[0],
    users: 1,
  }

  assert.throws(() => readSharedTokenFixtureMetadata(invalidMetadataRecords), /metadata is invalid/)

  const invalidUserRecords = [...records]

  invalidUserRecords[POOLS.R.firstSeq] = {
    ...invalidUserRecords[POOLS.R.firstSeq],
    token: '',
  }

  assert.throws(
    () => readSharedTokenUser(invalidUserRecords, POOLS.R.firstSeq, 'R'),
    /shared user 1 is invalid/,
  )
})

test('k6 runtime source loads one fixed file through one SharedArray', async () => {
  const source = await readFile(new URL('./k6/shared-token-fixture.js', import.meta.url), 'utf8')

  const sharedArrayCreations = source.match(/new SharedArray/g) ?? []

  assert.equal(sharedArrayCreations.length, 1)

  assert.match(source, /from\s+['"]k6\/data['"]/)

  assert.match(source, /['"]\/tmp\/tokens\.json['"]/)

  assert.match(source, /open\(TOKEN_FIXTURE_PATH\)/)

  assert.match(source, /buildSharedTokenFixtureRecords/)

  assert.doesNotMatch(source, /\.env\.staging|dotenv|console\.(log|error)/)
})
