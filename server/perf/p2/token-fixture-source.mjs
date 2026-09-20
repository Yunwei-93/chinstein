import { TOTAL_USERS } from '../fixture-config.mjs'

import { assertApprovedPerfSourceDataset } from '../seed-dataset-preflight.mjs'

import { assertSafeSeedClock } from '../seed-preflight.mjs'

import { PerfSafetyError } from '../staging-guard.mjs'

import { DESIGNATED_LOGIN_SEQUENCE, poolForSequence } from './token-fixture-contracts.mjs'

const EXPECTED_HOST_FINGERPRINT = '777c6ca41572'
const EXPECTED_DATABASE = 'neondb'

function fail(message) {
  throw new PerfSafetyError(`Unable to read PERF token source: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateDependencies({ assertSafeClock, assertApprovedSource }) {
  if (typeof assertSafeClock !== 'function' || typeof assertApprovedSource !== 'function') {
    fail('validation dependencies are incomplete')
  }
}

function validateConnectionInputs(client, environment) {
  if (!client || typeof client.query !== 'function') {
    fail('database client is unavailable')
  }

  if (!isObject(environment)) {
    fail('staging identity is unavailable')
  }

  if (environment.hostFingerprint !== EXPECTED_HOST_FINGERPRINT) {
    fail('staging host fingerprint is not approved')
  }

  if (environment.database !== EXPECTED_DATABASE) {
    fail('staging database identity is not approved')
  }
}

function buildMappedUsers(rows) {
  if (!Array.isArray(rows) || rows.length !== TOTAL_USERS) {
    fail(`expected exactly ${TOTAL_USERS} mapped users`)
  }

  const userIds = new Set()
  const users = []

  for (const [index, row] of rows.entries()) {
    const expectedSequence = index + 1
    const sequence = Number(row.sequence)
    const userId = Number(row.user_id)

    if (sequence !== expectedSequence) {
      fail(`expected user sequence ${expectedSequence}, received ${sequence}`)
    }

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      fail(`user ${expectedSequence} has an invalid database ID`)
    }

    if (userIds.has(userId)) {
      fail(`user ${expectedSequence} repeats a database ID`)
    }

    userIds.add(userId)

    const user = {
      sequence,
      userId,
      pool: poolForSequence(sequence),
    }

    if (sequence === DESIGNATED_LOGIN_SEQUENCE) {
      if (typeof row.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(row.email)) {
        fail('designated login user has an invalid email')
      }

      user.email = row.email
    }

    users.push(user)
  }

  return users
}

function buildDailyCharacter(rows, expectedCharacterId) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail('daily character could not be resolved')
  }

  const characterId = Number(rows[0].id)
  const answer = rows[0].answer

  if (
    !Number.isSafeInteger(characterId) ||
    characterId <= 0 ||
    characterId !== expectedCharacterId
  ) {
    fail('daily character ID differs from the approved fixture')
  }

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    fail('daily character answer is invalid')
  }

  return {
    id: characterId,
    answer,
  }
}

export async function readTokenFixtureSource(
  { client, environment },
  {
    assertSafeClock = assertSafeSeedClock,
    assertApprovedSource = assertApprovedPerfSourceDataset,
  } = {},
) {
  validateConnectionInputs(client, environment)

  validateDependencies({
    assertSafeClock,
    assertApprovedSource,
  })

  const clock = await assertSafeClock(client)

  if (clock.transactionReadOnly !== 'on') {
    fail('source transaction is not read-only')
  }

  if (clock.database !== EXPECTED_DATABASE || clock.database !== environment.database) {
    fail('source clock reports the wrong database')
  }

  const transactionResult = await client.query(`
    SELECT
      current_setting(
        'transaction_isolation'
      ) AS transaction_isolation,
      current_setting(
        'transaction_read_only'
      ) AS transaction_read_only
  `)

  const transaction = transactionResult.rows[0]

  if (transaction?.transaction_isolation !== 'repeatable read') {
    fail('source transaction is not repeatable read')
  }

  if (transaction.transaction_read_only !== 'on') {
    fail('source transaction permits writes')
  }

  const dataset = await assertApprovedSource(client)

  if (dataset?.classification !== 'approved-perf-source') {
    fail('source dataset is not an approved PERF fixture')
  }

  if (dataset.sourceSeedDate !== clock.seedDate || dataset.currentDate !== clock.seedDate) {
    fail('source fixture is not anchored to the current database date')
  }

  if (dataset.poolAFixtureDateSessions !== 0) {
    fail('Pool A must be unused before P2 baseline token generation')
  }

  if (dataset.users !== TOTAL_USERS || dataset.userMappings !== TOTAL_USERS) {
    fail('source user mapping totals are incomplete')
  }

  const dailyCharacterId = Number(dataset.dailyCharacterId)

  if (!Number.isSafeInteger(dailyCharacterId) || dailyCharacterId <= 0) {
    fail('approved daily character ID is invalid')
  }

  const userResult = await client.query(
    `
      SELECT
        pu.seq AS sequence,
        pu.user_id,
        CASE
          WHEN pu.seq = $1::integer
          THEN u.email
          ELSE NULL
        END AS email
      FROM public.perf_users AS pu
      JOIN public.users AS u
        ON u.id = pu.user_id
      ORDER BY pu.seq
    `,
    [DESIGNATED_LOGIN_SEQUENCE],
  )

  const users = buildMappedUsers(userResult.rows)

  const characterResult = await client.query(
    `
      SELECT
        id,
        meaning AS answer
      FROM public.characters
      WHERE id = $1::integer
    `,
    [dailyCharacterId],
  )

  const dailyCharacter = buildDailyCharacter(characterResult.rows, dailyCharacterId)

  return {
    source: {
      hostFingerprint: environment.hostFingerprint,
      database: clock.database,
      seedDate: clock.seedDate,
    },
    users,
    dailyCharacter,
  }
}
