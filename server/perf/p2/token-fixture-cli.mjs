import { pathToFileURL } from 'node:url'

import { POOLS, TOTAL_USERS } from '../fixture-config.mjs'

import { TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'
import { DEFAULT_TOKEN_FIXTURE_PATH } from './token-fixture-file.mjs'
import { generateTokenFixture } from './token-fixture-generator.mjs'

const REQUIRED_ARGUMENTS = Object.freeze([
  '--generate-token-fixture',
  '--confirm-aws-staging',
  '--confirm-private-output',
])

const EXPECTED_HOST_FINGERPRINT = '777c6ca41572'
const EXPECTED_DATABASE = 'neondb'

const EXPECTED_POOL_COUNTS = Object.freeze(
  Object.fromEntries(Object.entries(POOLS).map(([poolName, pool]) => [poolName, pool.users])),
)

class TokenFixtureCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TokenFixtureCliError'
  }
}

function fail(message) {
  throw new TokenFixtureCliError(message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function defaultWriteOutput(value) {
  process.stdout.write(value)
}

function defaultWriteError(value) {
  process.stderr.write(value)
}

function validateArguments(args) {
  if (
    !Array.isArray(args) ||
    args.length !== REQUIRED_ARGUMENTS.length ||
    !args.every((argument, index) => argument === REQUIRED_ARGUMENTS[index])
  ) {
    fail('Use the exact token fixture confirmation flags')
  }
}

function validateDependencies({ generate, writeOutput, writeError }) {
  if (
    typeof generate !== 'function' ||
    typeof writeOutput !== 'function' ||
    typeof writeError !== 'function'
  ) {
    fail('Token fixture CLI dependencies are incomplete')
  }
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

function buildSafeSuccess(generated) {
  if (
    !isObject(generated) ||
    generated.check !== 'p2-token-fixture-generation' ||
    generated.compiledSignerReady !== true ||
    !isObject(generated.source) ||
    generated.source.hostFingerprint !== EXPECTED_HOST_FINGERPRINT ||
    generated.source.database !== EXPECTED_DATABASE ||
    typeof generated.source.seedDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(generated.source.seedDate) ||
    generated.databaseRead.isolation !== 'repeatable read' ||
    generated.databaseRead.readOnly !== true ||
    generated.databaseRead.committed !== true ||
    generated.databaseRead.connectionClosed !== true ||
    !isObject(generated.artifact) ||
    generated.artifact.destination !== DEFAULT_TOKEN_FIXTURE_PATH ||
    !Number.isSafeInteger(generated.artifact.bytesWritten) ||
    generated.artifact.bytesWritten <= 0 ||
    generated.artifact.fileMode !== '0600' ||
    generated.artifact.atomicWrite !== true ||
    generated.usersWritten !== TOTAL_USERS ||
    !poolCountsMatch(generated.pools) ||
    generated.tokenTtlSeconds !== TOKEN_TTL_SECONDS ||
    !Number.isInteger(generated.tokenIssueSpreadSeconds) ||
    generated.tokenIssueSpreadSeconds < 0 ||
    !Number.isInteger(generated.remainingTokenSeconds) ||
    generated.remainingTokenSeconds <= 0 ||
    generated.tokensReturned !== false ||
    generated.secretsReturned !== false
  ) {
    fail('Token fixture generator returned an invalid summary')
  }

  return {
    check: 'p2-token-fixture-cli',
    status: 'complete',
    compiledSignerReady: true,
    source: {
      hostFingerprint: generated.source.hostFingerprint,
      database: generated.source.database,
      seedDate: generated.source.seedDate,
    },
    databaseRead: {
      isolation: generated.databaseRead.isolation,
      readOnly: true,
      committed: true,
      connectionClosed: true,
    },
    artifact: {
      destination: generated.artifact.destination,
      bytesWritten: generated.artifact.bytesWritten,
      fileMode: generated.artifact.fileMode,
      atomicWrite: true,
    },
    usersWritten: generated.usersWritten,
    pools: {
      ...EXPECTED_POOL_COUNTS,
    },
    tokenTtlSeconds: generated.tokenTtlSeconds,
    tokenIssueSpreadSeconds: generated.tokenIssueSpreadSeconds,
    remainingTokenSeconds: generated.remainingTokenSeconds,
    tokensReturned: false,
    secretsReturned: false,
  }
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)) {
    return error.code
  }

  return null
}

function buildSafeFailure(error) {
  return {
    check: 'p2-token-fixture-cli',
    status: 'failed',
    error:
      error instanceof TokenFixtureCliError ? error.message : 'Token fixture generation failed',
    code: safeErrorCode(error),
    tokensReturned: false,
    secretsReturned: false,
  }
}

export async function runTokenFixtureCli({
  args = process.argv.slice(2),
  generate = generateTokenFixture,
  writeOutput = defaultWriteOutput,
  writeError = defaultWriteError,
} = {}) {
  let generatorCalled = false

  try {
    validateDependencies({
      generate,
      writeOutput,
      writeError,
    })

    validateArguments(args)

    generatorCalled = true

    const generated = await generate()
    const safeOutput = buildSafeSuccess(generated)

    writeOutput(`${JSON.stringify(safeOutput, null, 2)}\n`)

    return Object.freeze({
      exitCode: 0,
      generatorCalled,
    })
  } catch (error) {
    const safeFailure = buildSafeFailure(error)

    if (typeof writeError === 'function') {
      try {
        writeError(`${JSON.stringify(safeFailure, null, 2)}\n`)
      } catch {}
    }

    return Object.freeze({
      exitCode: 1,
      generatorCalled,
    })
  }
}

function isDirectExecution() {
  const entryPath = process.argv[1]

  return (
    typeof entryPath === 'string' &&
    entryPath.length > 0 &&
    import.meta.url === pathToFileURL(entryPath).href
  )
}

if (isDirectExecution()) {
  const result = await runTokenFixtureCli()

  process.exitCode = result.exitCode
}
