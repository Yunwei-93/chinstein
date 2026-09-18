import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import bcrypt from 'bcrypt'

import {
  assertPerfPasswordHash,
  createPerfPasswordHash,
  createPerfUsers,
} from '../seed-operations.mjs'
import { runRollbackSeedDryRun } from '../seed-dry-run.mjs'

const TEST_PASSWORD = 'p'.repeat(32)
const VALID_FAKE_HASH = `$2b$10$${'A'.repeat(53)}`

test('creates one bcrypt hash from the approved login password', async () => {
  const passwordHash = await createPerfPasswordHash({
    environment: {
      PERF_LOGIN_PASSWORD: TEST_PASSWORD,
    },
  })

  assert.match(passwordHash, /^\$2b\$10\$[./A-Za-z0-9]{53}$/)
  assert.equal(bcrypt.getRounds(passwordHash), 10)
  assert.equal(await bcrypt.compare(TEST_PASSWORD, passwordHash), true)
  assert.notEqual(passwordHash, TEST_PASSWORD)
})

test('passes the validated password to bcrypt exactly once', async () => {
  const calls = []

  const passwordHash = await createPerfPasswordHash({
    environment: {
      PERF_LOGIN_PASSWORD: TEST_PASSWORD,
    },
    async hashPassword(password, rounds) {
      calls.push({
        password,
        rounds,
      })

      return VALID_FAKE_HASH
    },
  })

  assert.equal(passwordHash, VALID_FAKE_HASH)
  assert.deepEqual(calls, [
    {
      password: TEST_PASSWORD,
      rounds: 10,
    },
  ])
})

test('rejects invalid login passwords before bcrypt runs', async () => {
  const environments = [
    {},
    {
      PERF_LOGIN_PASSWORD: 'p'.repeat(31),
    },
    {
      PERF_LOGIN_PASSWORD: 'p'.repeat(73),
    },
    {
      PERF_LOGIN_PASSWORD: `${'p'.repeat(32)}\n`,
    },
  ]

  let hashCalls = 0

  for (const environment of environments) {
    await assert.rejects(
      createPerfPasswordHash({
        environment,
        async hashPassword() {
          hashCalls += 1
          return VALID_FAKE_HASH
        },
      }),
      /PERF_LOGIN_PASSWORD is missing or invalid/,
    )
  }

  assert.equal(hashCalls, 0)
})

test('suppresses bcrypt errors without exposing the password', async () => {
  let observedError

  try {
    await createPerfPasswordHash({
      environment: {
        PERF_LOGIN_PASSWORD: TEST_PASSWORD,
      },
      async hashPassword() {
        throw new Error(`Unable to hash ${TEST_PASSWORD}`)
      },
    })
  } catch (error) {
    observedError = error
  }

  assert.ok(observedError instanceof Error)
  assert.equal(observedError.message, 'Unable to create PERF password hash')
  assert.equal(observedError.message.includes(TEST_PASSWORD), false)
  assert.equal((observedError.stack ?? '').includes(TEST_PASSWORD), false)
})

test('rejects invalid output returned by the password hasher', async () => {
  const invalidHashes = [
    'not-a-password-hash',
    `$2b$12$${'A'.repeat(53)}`,
    `$2a$10$${'A'.repeat(53)}`,
  ]

  for (const invalidHash of invalidHashes) {
    await assert.rejects(
      createPerfPasswordHash({
        environment: {
          PERF_LOGIN_PASSWORD: TEST_PASSWORD,
        },
        async hashPassword() {
          return invalidHash
        },
      }),
      /A valid PERF bcrypt password hash is required/,
    )
  }
})

test('accepts only the approved bcrypt hash shape', () => {
  assert.equal(assertPerfPasswordHash(VALID_FAKE_HASH), VALID_FAKE_HASH)

  for (const invalidValue of [
    undefined,
    null,
    '',
    TEST_PASSWORD,
    `$2b$09$${'A'.repeat(53)}`,
    `$2b$10$${'A'.repeat(52)}`,
  ]) {
    assert.throws(
      () => assertPerfPasswordHash(invalidValue),
      /A valid PERF bcrypt password hash is required/,
    )
  }
})

test('createPerfUsers rejects plaintext before issuing SQL', async () => {
  let queryCalls = 0

  const client = {
    async query() {
      queryCalls += 1
      throw new Error('SQL must not run')
    },
  }

  await assert.rejects(
    createPerfUsers(client, TEST_PASSWORD),
    /A valid PERF bcrypt password hash is required/,
  )

  assert.equal(queryCalls, 0)
})

test('rollback dry-run rejects plaintext before issuing SQL', async () => {
  let queryCalls = 0

  const client = {
    async query() {
      queryCalls += 1
      throw new Error('SQL must not run')
    },
  }

  await assert.rejects(
    runRollbackSeedDryRun(client, {
      passwordHash: TEST_PASSWORD,
    }),
    /A valid PERF bcrypt password hash is required/,
  )

  assert.equal(queryCalls, 0)
})

test('seed entrypoint prepares the password hash before database access', async () => {
  const [operationsSource, stagingSource, dryRunSource, commitSource] = await Promise.all([
    readFile(new URL('../seed-operations.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../seed-staging.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../seed-dry-run.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../seed-commit.mjs', import.meta.url), 'utf8'),
  ])

  const passwordGateIndex = stagingSource.indexOf('passwordHash = await createPerfPasswordHash()')
  const committedSeedIndex = stagingSource.indexOf(
    'const committedSeedResult = await runCommittedSeed',
  )
  const stagingConnectionIndex = stagingSource.indexOf('connection = await connectToStaging()')

  assert.ok(passwordGateIndex >= 0)
  assert.ok(committedSeedIndex > passwordGateIndex)
  assert.ok(stagingConnectionIndex > passwordGateIndex)

  assert.doesNotMatch(operationsSource, /randomBytes/)
  assert.match(operationsSource, /requirePerfLoginPassword/)
  assert.doesNotMatch(dryRunSource, /createPerfPasswordHash/)
  assert.doesNotMatch(commitSource, /createPerfPasswordHash/)
})
