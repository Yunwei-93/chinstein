import { constants as fileSystemConstants } from 'node:fs'
import { open as openFile } from 'node:fs/promises'

import { connectToP2StagingRuntime } from './runtime-staging-connector.mjs'
import { requirePerfLoginPassword, validatePerfLoginPassword } from './login-secret-contract.mjs'
import { DEFAULT_TOKEN_FIXTURE_PATH } from './token-fixture-file.mjs'
import {
  buildSharedTokenFixtureRecords,
  readSharedTokenFixtureMetadata,
  readSharedTokenUser,
} from './k6/k6-token-fixture-contracts.mjs'
import { createP2PremeasurementHttpAdapter } from './premeasurement-http-adapter.mjs'

const OWNER_READ_WRITE = 0o600
const MAX_TOKEN_FIXTURE_BYTES = 16 * 1024 * 1024
const DESIGNATED_LOGIN_SEQUENCE = 1
const APPROVED_DATABASE_TIMEZONES = new Set(['GMT', 'UTC', 'Etc/UTC'])

const CONNECTION_KEYS = ['client', 'identity']
const IDENTITY_KEYS = [
  'current_date',
  'database',
  'hostFingerprint',
  'in_recovery',
  'server_version',
  'timezone',
  'wall_date',
]

function fail(stage) {
  throw new Error(`PERF-P2 runtime adapter failed at ${stage}`)
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

function readDefaultEffectiveUserId() {
  if (typeof process.geteuid !== 'function') {
    fail('token-fixture-owner')
  }

  return process.geteuid()
}

function readDefaultClock() {
  return Math.floor(Date.now() / 1000)
}

function validateFactoryInputs({
  environment,
  observeDeployment,
  openTokenFixture,
  connectToStaging,
  createHttpAdapter,
  fetchImpl,
  nowSeconds,
  readEffectiveUserId,
}) {
  if (!isObject(environment) || typeof observeDeployment !== 'function') {
    fail('factory-input')
  }

  for (const dependency of [
    openTokenFixture,
    connectToStaging,
    createHttpAdapter,
    fetchImpl,
    nowSeconds,
    readEffectiveUserId,
  ]) {
    if (typeof dependency !== 'function') {
      fail('factory-dependency')
    }
  }
}

function validateWholeUnixSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('clock')
  }

  return value
}

function createSafeClock(nowSeconds) {
  return function readClock() {
    let value

    try {
      value = nowSeconds()
    } catch {
      fail('clock')
    }

    return validateWholeUnixSeconds(value)
  }
}

function validateTokenFixtureMetadata(metadata, expectedUserId) {
  if (
    !metadata ||
    typeof metadata.isFile !== 'function' ||
    metadata.isFile() !== true ||
    !Number.isSafeInteger(metadata.mode) ||
    (metadata.mode & 0o777) !== OWNER_READ_WRITE ||
    !Number.isSafeInteger(metadata.uid) ||
    metadata.uid !== expectedUserId ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size <= 0 ||
    metadata.size > MAX_TOKEN_FIXTURE_BYTES
  ) {
    fail('token-fixture-metadata')
  }

  return metadata
}

function validateTokenFixtureHandle(handle) {
  if (
    !handle ||
    typeof handle.stat !== 'function' ||
    typeof handle.readFile !== 'function' ||
    typeof handle.close !== 'function'
  ) {
    fail('token-fixture-open')
  }

  return handle
}

async function closeTokenFixture(handle) {
  try {
    await handle.close()
  } catch {
    fail('token-fixture-close')
  }
}

async function loadTokenFixtureEvidence({ openTokenFixture, nowSeconds, readEffectiveUserId }) {
  let handle = null
  let serializedFixture

  try {
    handle = await openTokenFixture(
      DEFAULT_TOKEN_FIXTURE_PATH,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    )
    validateTokenFixtureHandle(handle)

    const effectiveUserId = readEffectiveUserId()
    const metadata = validateTokenFixtureMetadata(await handle.stat(), effectiveUserId)

    serializedFixture = await handle.readFile('utf8')

    if (
      typeof serializedFixture !== 'string' ||
      Buffer.byteLength(serializedFixture, 'utf8') !== metadata.size
    ) {
      fail('token-fixture-read')
    }
  } catch (error) {
    if (handle) {
      await closeTokenFixture(handle)
    }

    if (
      error instanceof Error &&
      error.message === 'PERF-P2 runtime adapter failed at token-fixture-close'
    ) {
      throw error
    }

    fail('token-fixture-read')
  }

  await closeTokenFixture(handle)

  try {
    const records = buildSharedTokenFixtureRecords(serializedFixture, {
      nowSeconds,
    })

    return {
      fixtureMetadata: readSharedTokenFixtureMetadata(records),
      designatedUser: readSharedTokenUser(records, DESIGNATED_LOGIN_SEQUENCE, 'R'),
    }
  } catch {
    fail('token-fixture-validation')
  }
}

function validateDatabaseConnection(connection, client) {
  if (
    !hasExactKeys(connection, CONNECTION_KEYS) ||
    !client ||
    typeof client.end !== 'function' ||
    !hasExactKeys(connection.identity, IDENTITY_KEYS)
  ) {
    return null
  }

  const identity = connection.identity

  if (
    typeof identity.database !== 'string' ||
    identity.database.length === 0 ||
    typeof identity.hostFingerprint !== 'string' ||
    !/^[a-f0-9]{12}$/.test(identity.hostFingerprint) ||
    typeof identity.current_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(identity.current_date) ||
    new Date(`${identity.current_date}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      identity.current_date ||
    identity.current_date !== identity.wall_date ||
    !APPROVED_DATABASE_TIMEZONES.has(identity.timezone) ||
    typeof identity.server_version !== 'string' ||
    identity.server_version.length === 0 ||
    identity.in_recovery !== false
  ) {
    return null
  }

  return {
    database: identity.database,
    databaseHostFingerprint: identity.hostFingerprint,
    databaseCurrentDate: identity.current_date,
    connectionClosed: true,
  }
}

async function closeDatabaseClient(client) {
  try {
    await client.end()
  } catch {
    fail('database-close')
  }
}

async function readDatabaseEvidence({ environment, connectToStaging }) {
  let connection

  try {
    connection = await connectToStaging({
      environment,
    })
  } catch {
    fail('database-connect')
  }

  let client
  let evidence = null

  try {
    client = connection?.client
  } catch {}

  try {
    evidence = validateDatabaseConnection(connection, client)
  } catch {}

  await closeDatabaseClient(client)

  if (!evidence) {
    fail('database-identity')
  }

  return evidence
}

function readLoginPassword(environment) {
  let password

  try {
    password = requirePerfLoginPassword(environment)
    validatePerfLoginPassword(password)
  } catch {
    fail('login-password')
  }

  return password
}

function createSafeDeploymentObserver(observeDeployment) {
  return async function observeDeploymentSafely() {
    try {
      return await observeDeployment()
    } catch {
      fail('deployment-observation')
    }
  }
}

export function createP2PremeasurementRuntimeDependencies(
  { environment = process.env, observeDeployment } = {},
  {
    openTokenFixture = openFile,
    connectToStaging = connectToP2StagingRuntime,
    createHttpAdapter = createP2PremeasurementHttpAdapter,
    fetchImpl = globalThis.fetch,
    nowSeconds = readDefaultClock,
    readEffectiveUserId = readDefaultEffectiveUserId,
  } = {},
) {
  validateFactoryInputs({
    environment,
    observeDeployment,
    openTokenFixture,
    connectToStaging,
    createHttpAdapter,
    fetchImpl,
    nowSeconds,
    readEffectiveUserId,
  })

  const safeClock = createSafeClock(nowSeconds)
  let httpAdapter

  try {
    httpAdapter = createHttpAdapter({
      fetchImpl,
    })
  } catch {
    fail('http-adapter')
  }

  if (
    !hasExactKeys(httpAdapter, ['executeCanary']) ||
    typeof httpAdapter.executeCanary !== 'function'
  ) {
    fail('http-adapter')
  }

  return Object.freeze({
    executeCanary: httpAdapter.executeCanary,

    loadFixtureEvidence() {
      return loadTokenFixtureEvidence({
        openTokenFixture,
        nowSeconds: safeClock,
        readEffectiveUserId,
      })
    },

    nowSeconds: safeClock,
    observeDeployment: createSafeDeploymentObserver(observeDeployment),

    readDatabaseEvidence() {
      return readDatabaseEvidence({
        environment,
        connectToStaging,
      })
    },

    readLoginPassword() {
      return readLoginPassword(environment)
    },
  })
}
