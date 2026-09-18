import { lstat as lstatFile, readFile as readTextFile } from 'node:fs/promises'

import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'
import { connectToStaging, PerfSafetyError } from '../staging-guard.mjs'

import { buildTokenFixture } from './token-fixture-builder.mjs'
import { TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'
import { DEFAULT_TOKEN_FIXTURE_PATH, writeTokenFixtureAtomically } from './token-fixture-file.mjs'
import { readTokenFixtureSource } from './token-fixture-source.mjs'

const AUTH_SOURCE_URL = new URL('../../src/auth.ts', import.meta.url)

const AUTH_BUILD_URL = new URL('../../dist/auth.js', import.meta.url)

const TSCONFIG_URL = new URL('../../tsconfig.json', import.meta.url)

const SOURCE_TRANSACTION_BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'

const EXPECTED_HOST_FINGERPRINT = '777c6ca41572'
const EXPECTED_DATABASE = 'neondb'

const EXPECTED_POOL_COUNTS = Object.freeze(
  Object.fromEntries(Object.entries(POOLS).map(([poolName, pool]) => [poolName, pool.users])),
)

function fail(message, code = null) {
  throw new PerfSafetyError(`Unable to generate PERF token fixture: ${message}`, code)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : null
}

function stageError(error, stage) {
  if (error instanceof PerfSafetyError) {
    return error
  }

  return new PerfSafetyError(
    `Unable to generate PERF token fixture during ${stage}`,
    errorCode(error),
  )
}

function isRegularFile(metadata) {
  return (
    metadata !== null &&
    typeof metadata === 'object' &&
    typeof metadata.isFile === 'function' &&
    metadata.isFile()
  )
}

function containsRelativeImport(source) {
  return (
    /\bfrom\s+['"]\.{1,2}\//.test(source) ||
    /\bimport\s+['"]\.{1,2}\//.test(source) ||
    /\bimport\s*\(\s*['"]\.{1,2}\//.test(source)
  )
}

export async function assertBuiltApplicationSigner({
  lstat = lstatFile,
  readFile = readTextFile,
} = {}) {
  if (typeof lstat !== 'function' || typeof readFile !== 'function') {
    fail('compiled-signer gate dependencies are incomplete')
  }

  let sourceMetadata
  let buildMetadata
  let configMetadata
  let buildSource

  try {
    ;[sourceMetadata, buildMetadata, configMetadata] = await Promise.all([
      lstat(AUTH_SOURCE_URL),
      lstat(AUTH_BUILD_URL),
      lstat(TSCONFIG_URL),
    ])

    buildSource = await readFile(AUTH_BUILD_URL, 'utf8')
  } catch {
    fail('compiled signer is unavailable; run npm run build')
  }

  if (
    !isRegularFile(sourceMetadata) ||
    !isRegularFile(buildMetadata) ||
    !isRegularFile(configMetadata)
  ) {
    fail('compiled signer inputs must be regular files; run npm run build')
  }

  const newestInputTime = Math.max(Number(sourceMetadata.mtimeMs), Number(configMetadata.mtimeMs))

  const buildTime = Number(buildMetadata.mtimeMs)

  if (
    !Number.isFinite(newestInputTime) ||
    !Number.isFinite(buildTime) ||
    buildTime < newestInputTime
  ) {
    fail('compiled signer is stale; run npm run build')
  }

  if (
    typeof buildSource !== 'string' ||
    !/\bexport\s+function\s+signToken\s*\(/.test(buildSource)
  ) {
    fail('compiled signer export is unavailable; run npm run build')
  }

  if (containsRelativeImport(buildSource)) {
    fail('compiled signer has an unapproved relative dependency')
  }

  return Object.freeze({
    compiledSignerReady: true,
  })
}

async function loadDefaultJwtAdapter() {
  const loaded = await import('./token-fixture-jwt-adapter.mjs')

  if (typeof loaded.createTokenFixtureJwtAdapter !== 'function') {
    fail('JWT adapter factory is unavailable')
  }

  return loaded.createTokenFixtureJwtAdapter()
}

function validateDependencies(dependencies) {
  const requiredFunctions = [
    'assertBuiltSigner',
    'connectToStaging',
    'readTokenFixtureSource',
    'loadJwtAdapter',
    'buildTokenFixture',
    'writeTokenFixtureAtomically',
    'nowSeconds',
  ]

  for (const name of requiredFunctions) {
    if (typeof dependencies[name] !== 'function') {
      fail(`dependency ${name} is unavailable`)
    }
  }
}

function validateConnection(connection) {
  if (
    !isObject(connection) ||
    !isObject(connection.identity) ||
    !connection.client ||
    typeof connection.client.query !== 'function' ||
    typeof connection.client.end !== 'function'
  ) {
    fail('staging connection is incomplete')
  }
}

function validateSourceResult(result) {
  if (
    !isObject(result) ||
    !isObject(result.source) ||
    !Array.isArray(result.users) ||
    !isObject(result.dailyCharacter)
  ) {
    fail('approved source reader returned an invalid result')
  }

  if (
    result.source.hostFingerprint !== EXPECTED_HOST_FINGERPRINT ||
    result.source.database !== EXPECTED_DATABASE ||
    typeof result.source.seedDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.source.seedDate)
  ) {
    fail('approved source identity differs from the expected staging fixture')
  }

  if (result.users.length !== TOTAL_USERS) {
    fail(`approved source must contain exactly ${TOTAL_USERS} users`)
  }

  if (
    !Number.isSafeInteger(result.dailyCharacter.id) ||
    result.dailyCharacter.id <= 0 ||
    typeof result.dailyCharacter.answer !== 'string' ||
    result.dailyCharacter.answer.trim().length === 0
  ) {
    fail('approved source daily character is invalid')
  }
}

async function cleanFailedSourceRead(connection, transactionOpen) {
  if (!connection) {
    return {
      rollbackConfirmed: !transactionOpen,
      closeConfirmed: true,
    }
  }

  const client = connection.client

  let rollbackConfirmed = !transactionOpen
  let closeConfirmed = false

  if (transactionOpen && typeof client?.query === 'function') {
    try {
      await client.query('ROLLBACK')
      rollbackConfirmed = true
    } catch {}
  }

  if (typeof client?.end === 'function') {
    try {
      await client.end()
      closeConfirmed = true
    } catch {}
  }

  return {
    rollbackConfirmed,
    closeConfirmed,
  }
}

async function readSourceAndClose({ connectToStaging, readTokenFixtureSource }) {
  let connection = null
  let sourceResult = null
  let transactionOpen = false
  let stage = 'connect-to-staging'

  try {
    connection = await connectToStaging()

    validateConnection(connection)

    const { client, identity: environment } = connection

    stage = 'begin-source-transaction'

    await client.query(SOURCE_TRANSACTION_BEGIN)

    transactionOpen = true

    stage = 'configure-source-transaction'

    await client.query("SET LOCAL TIME ZONE 'UTC'")

    await client.query('SET LOCAL lock_timeout = 5000')

    await client.query('SET LOCAL statement_timeout = 900000')

    stage = 'read-approved-source'

    sourceResult = await readTokenFixtureSource({
      client,
      environment,
    })

    validateSourceResult(sourceResult)

    stage = 'commit-source-transaction'

    await client.query('COMMIT')

    transactionOpen = false
  } catch (error) {
    const cleanup = await cleanFailedSourceRead(connection, transactionOpen)

    if (!cleanup.rollbackConfirmed || !cleanup.closeConfirmed) {
      fail('source transaction cleanup could not be confirmed', errorCode(error))
    }

    throw stageError(error, stage)
  }

  stage = 'close-source-connection'

  try {
    await connection.client.end()
  } catch (error) {
    throw stageError(error, stage)
  }

  return sourceResult
}

function poolCountsMatch(actual) {
  if (!isObject(actual)) {
    return false
  }

  const expectedNames = Object.keys(EXPECTED_POOL_COUNTS).sort()

  const actualNames = Object.keys(actual).sort()

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    return false
  }

  return expectedNames.every((poolName) => actual[poolName] === EXPECTED_POOL_COUNTS[poolName])
}

function validateBuildResult(result) {
  if (!isObject(result) || !isObject(result.fixture) || !isObject(result.summary)) {
    fail('fixture builder returned an invalid result')
  }

  const { summary } = result

  if (
    summary.users !== TOTAL_USERS ||
    !poolCountsMatch(summary.pools) ||
    summary.tokenTtlSeconds !== TOKEN_TTL_SECONDS ||
    summary.tokensReturned !== false ||
    summary.loginPasswordStored !== false ||
    !Number.isInteger(summary.tokenIssueSpreadSeconds) ||
    summary.tokenIssueSpreadSeconds < 0 ||
    !Number.isInteger(summary.remainingTokenSeconds) ||
    summary.remainingTokenSeconds <= 0
  ) {
    fail('fixture builder summary differs from the approved contract')
  }
}

function validateWriteResult(result) {
  if (
    !isObject(result) ||
    result.destination !== DEFAULT_TOKEN_FIXTURE_PATH ||
    !Number.isSafeInteger(result.bytesWritten) ||
    result.bytesWritten <= 0 ||
    result.usersWritten !== TOTAL_USERS ||
    !poolCountsMatch(result.pools) ||
    result.tokenTtlSeconds !== TOKEN_TTL_SECONDS ||
    result.fileMode !== '0600' ||
    result.atomicWrite !== true ||
    result.tokensReturned !== false
  ) {
    fail('fixture writer summary differs from the approved contract')
  }
}

function buildSafeSummary(sourceResult, buildResult, writeResult) {
  return Object.freeze({
    check: 'p2-token-fixture-generation',
    compiledSignerReady: true,
    source: Object.freeze({
      hostFingerprint: sourceResult.source.hostFingerprint,
      database: sourceResult.source.database,
      seedDate: sourceResult.source.seedDate,
    }),
    databaseRead: Object.freeze({
      isolation: 'repeatable read',
      readOnly: true,
      committed: true,
      connectionClosed: true,
    }),
    artifact: Object.freeze({
      destination: DEFAULT_TOKEN_FIXTURE_PATH,
      bytesWritten: writeResult.bytesWritten,
      fileMode: '0600',
      atomicWrite: true,
    }),
    usersWritten: TOTAL_USERS,
    pools: Object.freeze({
      ...EXPECTED_POOL_COUNTS,
    }),
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    tokenIssueSpreadSeconds: buildResult.summary.tokenIssueSpreadSeconds,
    remainingTokenSeconds: buildResult.summary.remainingTokenSeconds,
    tokensReturned: false,
    secretsReturned: false,
  })
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  assertBuiltSigner: assertBuiltApplicationSigner,
  connectToStaging,
  readTokenFixtureSource,
  loadJwtAdapter: loadDefaultJwtAdapter,
  buildTokenFixture,
  writeTokenFixtureAtomically,
  nowSeconds: () => Math.floor(Date.now() / 1000),
})

export async function generateTokenFixture(options = {}, dependencyOverrides = {}) {
  if (!isObject(options) || !isObject(dependencyOverrides)) {
    fail('generator options are invalid')
  }

  const destination = hasOwn(options, 'destination')
    ? options.destination
    : DEFAULT_TOKEN_FIXTURE_PATH

  if (destination !== DEFAULT_TOKEN_FIXTURE_PATH) {
    fail('fixture destination must be /tmp/tokens.json')
  }

  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencyOverrides,
  }

  validateDependencies(dependencies)

  let stage = 'compiled-signer-gate'

  try {
    const buildGate = await dependencies.assertBuiltSigner()

    if (buildGate?.compiledSignerReady !== true) {
      fail('compiled-signer gate did not confirm readiness')
    }

    stage = 'read-approved-source'

    const sourceResult = await readSourceAndClose(dependencies)

    // Load the JWT module only after the database transaction
    // is committed and the connection is closed.
    stage = 'load-jwt-adapter'

    const jwtAdapter = await dependencies.loadJwtAdapter()

    if (
      !isObject(jwtAdapter) ||
      typeof jwtAdapter.signTokenForUser !== 'function' ||
      typeof jwtAdapter.verifySignedToken !== 'function'
    ) {
      fail('JWT adapter is incomplete')
    }

    stage = 'build-token-fixture'

    const buildResult = await dependencies.buildTokenFixture({
      users: sourceResult.users,
      source: sourceResult.source,
      dailyCharacter: sourceResult.dailyCharacter,
      signTokenForUser: jwtAdapter.signTokenForUser,
      verifySignedToken: jwtAdapter.verifySignedToken,
      nowSeconds: dependencies.nowSeconds,
    })

    validateBuildResult(buildResult)

    stage = 'write-token-fixture'

    const writeResult = await dependencies.writeTokenFixtureAtomically(buildResult.fixture, {
      destination: DEFAULT_TOKEN_FIXTURE_PATH,
    })

    validateWriteResult(writeResult)

    return buildSafeSummary(sourceResult, buildResult, writeResult)
  } catch (error) {
    throw stageError(error, stage)
  }
}
