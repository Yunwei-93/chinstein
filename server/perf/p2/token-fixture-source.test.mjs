import assert from 'node:assert/strict'
import test from 'node:test'

import { TOTAL_USERS } from '../fixture-config.mjs'

import { DESIGNATED_LOGIN_SEQUENCE } from './token-fixture-contracts.mjs'
import { readTokenFixtureSource } from './token-fixture-source.mjs'

const SEED_DATE = '2026-09-18'
const DAILY_CHARACTER_ID = 274
const APPROVED_HOST_FINGERPRINT = '777c6ca41572'
const APPROVED_DATABASE = 'neondb'
const DESIGNATED_LOGIN_EMAIL = 'player_00001@example.invalid'

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function buildUserRows({ nonDesignatedEmail = null } = {}) {
  return Array.from({ length: TOTAL_USERS }, (_, index) => {
    const sequence = index + 1

    return {
      sequence,
      user_id: 10_000 + sequence,
      email: sequence === DESIGNATED_LOGIN_SEQUENCE ? DESIGNATED_LOGIN_EMAIL : nonDesignatedEmail,
    }
  })
}

function resolveRows(rows) {
  return typeof rows === 'function' ? rows() : rows
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function createHarness(options = {}) {
  const environment = {
    hostFingerprint: APPROVED_HOST_FINGERPRINT,
    database: APPROVED_DATABASE,
    ...(options.environment ?? {}),
  }

  const clock = {
    database: APPROVED_DATABASE,
    seedDate: SEED_DATE,
    transactionReadOnly: 'on',
    ...(options.clock ?? {}),
  }

  const transaction = {
    transaction_isolation: 'repeatable read',
    transaction_read_only: 'on',
    ...(options.transaction ?? {}),
  }

  const dataset = {
    classification: 'approved-perf-source',
    sourceSeedDate: SEED_DATE,
    currentDate: SEED_DATE,
    poolAFixtureDateSessions: 0,
    users: TOTAL_USERS,
    userMappings: TOTAL_USERS,
    dailyCharacterId: DAILY_CHARACTER_ID,
    ...(options.dataset ?? {}),
  }

  const userRows = hasOwn(options, 'userRows') ? options.userRows : buildUserRows

  const characterRows = hasOwn(options, 'characterRows')
    ? options.characterRows
    : () => [
        {
          id: dataset.dailyCharacterId,
          answer: 'known-answer',
        },
      ]

  const queries = []
  const events = []
  const dependencyClients = []

  const client = {
    async query(text, values = []) {
      const sql = normalizeSql(text)

      queries.push({
        sql,
        values: [...values],
      })

      if (sql.includes("'transaction_isolation'")) {
        events.push('transaction')

        return {
          rows: [transaction],
        }
      }

      if (sql.includes('FROM public.perf_users AS pu')) {
        events.push('users')

        return {
          rows: resolveRows(userRows),
        }
      }

      if (sql.includes('FROM public.characters')) {
        events.push('character')

        return {
          rows: resolveRows(characterRows),
        }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  async function assertSafeClock(receivedClient) {
    dependencyClients.push(receivedClient)
    events.push('clock')

    return clock
  }

  async function assertApprovedSource(receivedClient) {
    dependencyClients.push(receivedClient)
    events.push('source')

    return dataset
  }

  async function read() {
    return readTokenFixtureSource(
      {
        client,
        environment,
      },
      {
        assertSafeClock,
        assertApprovedSource,
      },
    )
  }

  return {
    client,
    queries,
    events,
    dependencyClients,
    read,
  }
}

test('reads a complete token source from one approved snapshot', async () => {
  const harness = createHarness()
  const result = await harness.read()

  assert.deepEqual(result.source, {
    hostFingerprint: APPROVED_HOST_FINGERPRINT,
    database: APPROVED_DATABASE,
    seedDate: SEED_DATE,
  })

  assert.equal(result.users.length, TOTAL_USERS)

  assert.deepEqual(result.dailyCharacter, {
    id: DAILY_CHARACTER_ID,
    answer: 'known-answer',
  })

  assert.deepEqual(harness.events, ['clock', 'transaction', 'source', 'users', 'character'])

  assert.equal(harness.dependencyClients.length, 2)

  for (const dependencyClient of harness.dependencyClients) {
    assert.equal(dependencyClient, harness.client)
  }
})

test('derives frozen pool boundaries and exposes only the designated email', async () => {
  const harness = createHarness({
    userRows: buildUserRows({
      nonDesignatedEmail: 'must-not-be-returned@example.invalid',
    }),
  })

  const result = await harness.read()

  assert.deepEqual(result.users[0], {
    sequence: 1,
    userId: 10_001,
    pool: 'R',
    email: DESIGNATED_LOGIN_EMAIL,
  })

  assert.equal(result.users[899].pool, 'R')
  assert.equal(result.users[900].pool, 'A')
  assert.equal(result.users[7899].pool, 'A')
  assert.equal(result.users[7900].pool, 'B')
  assert.equal(result.users[8099].pool, 'B')

  for (const user of result.users.slice(1)) {
    assert.equal(Object.hasOwn(user, 'email'), false)
  }
})

test('uses ordered parameterized read-only SQL without secret columns or transaction control', async () => {
  const harness = createHarness()

  await harness.read()

  assert.equal(harness.queries.length, 3)

  const transactionQuery = harness.queries.find(({ sql }) =>
    sql.includes("'transaction_isolation'"),
  )

  const userQuery = harness.queries.find(({ sql }) => sql.includes('FROM public.perf_users AS pu'))

  const characterQuery = harness.queries.find(({ sql }) => sql.includes('FROM public.characters'))

  assert.ok(transactionQuery)
  assert.ok(userQuery)
  assert.ok(characterQuery)

  assert.deepEqual(transactionQuery.values, [])
  assert.deepEqual(userQuery.values, [DESIGNATED_LOGIN_SEQUENCE])
  assert.deepEqual(characterQuery.values, [DAILY_CHARACTER_ID])

  assert.match(userQuery.sql, /ORDER BY pu\.seq\b/i)

  assert.match(
    userQuery.sql,
    /CASE WHEN pu\.seq = \$1::integer THEN u\.email ELSE NULL END AS email/i,
  )

  assert.doesNotMatch(
    userQuery.sql,
    /\b(?:password|password_hash|passwordhash|token|jwt|secret)\b/i,
  )

  const forbiddenSql =
    /\b(?:BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i

  for (const query of harness.queries) {
    assert.match(query.sql, /^SELECT\b/i)
    assert.doesNotMatch(query.sql, forbiddenSql)
  }
})

test('rejects unapproved staging identities', async () => {
  const cases = [
    {
      environment: {
        hostFingerprint: '032a14edbcd2',
      },
      expectedError: /staging host fingerprint is not approved/,
    },
    {
      environment: {
        database: 'production',
      },
      expectedError: /staging database identity is not approved/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      environment: testCase.environment,
    })

    await assert.rejects(harness.read(), testCase.expectedError)

    assert.equal(harness.queries.length, 0)
  }
})

test('rejects a clock that reports another database', async () => {
  const harness = createHarness({
    clock: {
      database: 'unexpected_database',
    },
  })

  await assert.rejects(harness.read(), /source clock reports the wrong database/)

  assert.equal(harness.queries.length, 0)
})

test('rejects a clock that is not read-only', async () => {
  const harness = createHarness({
    clock: {
      transactionReadOnly: 'off',
    },
  })

  await assert.rejects(harness.read(), /source transaction is not read-only/)

  assert.equal(harness.queries.length, 0)
})

test('rejects unsafe transaction settings', async () => {
  const cases = [
    {
      transaction: {
        transaction_isolation: 'read committed',
      },
      expectedError: /source transaction is not repeatable read/,
    },
    {
      transaction: {
        transaction_read_only: 'off',
      },
      expectedError: /source transaction permits writes/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      transaction: testCase.transaction,
    })

    await assert.rejects(harness.read(), testCase.expectedError)

    assert.deepEqual(harness.events, ['clock', 'transaction'])
  }
})

test('rejects a dataset that is not an approved PERF source', async () => {
  const harness = createHarness({
    dataset: {
      classification: 'approved-initial-staging',
    },
  })

  await assert.rejects(harness.read(), /source dataset is not an approved PERF fixture/)
})

test('rejects stale or mismatched source date anchors', async () => {
  const cases = [
    {
      sourceSeedDate: '2026-09-17',
    },
    {
      currentDate: '2026-09-17',
    },
  ]

  for (const dataset of cases) {
    const harness = createHarness({
      dataset,
    })

    await assert.rejects(
      harness.read(),
      /source fixture is not anchored to the current database date/,
    )
  }
})

test('rejects a source after Pool A baseline writes exist', async () => {
  const harness = createHarness({
    dataset: {
      poolAFixtureDateSessions: 1,
    },
  })

  await assert.rejects(harness.read(), /Pool A must be unused before P2 baseline token generation/)
})

test('rejects incomplete approved mapping totals', async () => {
  const cases = [
    {
      users: TOTAL_USERS - 1,
    },
    {
      userMappings: TOTAL_USERS - 1,
    },
  ]

  for (const dataset of cases) {
    const harness = createHarness({
      dataset,
    })

    await assert.rejects(harness.read(), /source user mapping totals are incomplete/)
  }
})

test('rejects fewer than 8100 mapped user rows', async () => {
  const rows = buildUserRows()
  rows.pop()

  const harness = createHarness({
    userRows: rows,
  })

  await assert.rejects(harness.read(), /expected exactly 8100 mapped users/)
})

test('rejects gaps and out-of-order mapped sequences', async () => {
  const gapRows = buildUserRows()

  gapRows[499] = {
    ...gapRows[499],
    sequence: 501,
  }

  const outOfOrderRows = buildUserRows()

  ;[outOfOrderRows[0], outOfOrderRows[1]] = [outOfOrderRows[1], outOfOrderRows[0]]

  for (const rows of [gapRows, outOfOrderRows]) {
    const harness = createHarness({
      userRows: rows,
    })

    await assert.rejects(harness.read(), /expected user sequence/)
  }
})

test('rejects duplicate, non-positive, and unsafe database user IDs', async () => {
  const duplicateRows = buildUserRows()

  duplicateRows[1] = {
    ...duplicateRows[1],
    user_id: duplicateRows[0].user_id,
  }

  const zeroIdRows = buildUserRows()

  zeroIdRows[0] = {
    ...zeroIdRows[0],
    user_id: 0,
  }

  const unsafeIdRows = buildUserRows()

  unsafeIdRows[0] = {
    ...unsafeIdRows[0],
    user_id: Number.MAX_SAFE_INTEGER + 1,
  }

  const cases = [
    {
      rows: duplicateRows,
      expectedError: /repeats a database ID/,
    },
    {
      rows: zeroIdRows,
      expectedError: /has an invalid database ID/,
    },
    {
      rows: unsafeIdRows,
      expectedError: /has an invalid database ID/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      userRows: testCase.rows,
    })

    await assert.rejects(harness.read(), testCase.expectedError)
  }
})

test('rejects missing and invalid designated login emails', async () => {
  const invalidEmails = [null, '', 'not-an-email', 'two words@example.invalid']

  for (const email of invalidEmails) {
    const rows = buildUserRows()

    rows[DESIGNATED_LOGIN_SEQUENCE - 1] = {
      ...rows[DESIGNATED_LOGIN_SEQUENCE - 1],
      email,
    }

    const harness = createHarness({
      userRows: rows,
    })

    await assert.rejects(harness.read(), /designated login user has an invalid email/)
  }
})

test('rejects invalid approved daily-character IDs before reading fixture rows', async () => {
  const invalidCharacterIds = [null, 0, 1.5, 'not-an-id']

  for (const dailyCharacterId of invalidCharacterIds) {
    const harness = createHarness({
      dataset: {
        dailyCharacterId,
      },
    })

    await assert.rejects(harness.read(), /approved daily character ID is invalid/)
  }
})

test('rejects unresolved, mismatched, and blank daily-character rows', async () => {
  const validCharacter = {
    id: DAILY_CHARACTER_ID,
    answer: 'known-answer',
  }

  const cases = [
    {
      characterRows: [],
      expectedError: /daily character could not be resolved/,
    },
    {
      characterRows: [
        validCharacter,
        {
          ...validCharacter,
        },
      ],
      expectedError: /daily character could not be resolved/,
    },
    {
      characterRows: [
        {
          id: DAILY_CHARACTER_ID + 1,
          answer: 'known-answer',
        },
      ],
      expectedError: /daily character ID differs from the approved fixture/,
    },
    {
      characterRows: [
        {
          id: DAILY_CHARACTER_ID,
          answer: '   ',
        },
      ],
      expectedError: /daily character answer is invalid/,
    },
  ]

  for (const testCase of cases) {
    const harness = createHarness({
      characterRows: testCase.characterRows,
    })

    await assert.rejects(harness.read(), testCase.expectedError)
  }
})
