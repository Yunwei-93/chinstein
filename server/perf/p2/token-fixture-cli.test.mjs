import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { runTokenFixtureCli } from './token-fixture-cli.mjs'

const CONFIRMED_ARGUMENTS = Object.freeze([
  '--generate-token-fixture',
  '--confirm-aws-staging',
  '--confirm-private-output',
])

const PRIVATE_TOKEN = 'private-token-marker'
const PRIVATE_SECRET = 'private-secret-marker'
const PRIVATE_DATABASE_URL =
  'postgresql://private-user:private-password@private-pooler.example.invalid/neondb'

function createValidSummary() {
  return {
    check: 'p2-token-fixture-generation',
    compiledSignerReady: true,
    source: {
      hostFingerprint: '777c6ca41572',
      database: 'neondb',
      seedDate: '2026-09-18',
      privateValue: PRIVATE_SECRET,
    },
    databaseRead: {
      isolation: 'repeatable read',
      readOnly: true,
      committed: true,
      connectionClosed: true,
    },
    artifact: {
      destination: '/tmp/tokens.json',
      bytesWritten: 1_500_000,
      fileMode: '0600',
      atomicWrite: true,
    },
    usersWritten: 8100,
    pools: {
      R: 900,
      A: 7000,
      B: 200,
    },
    tokenTtlSeconds: 14_400,
    tokenIssueSpreadSeconds: 3,
    remainingTokenSeconds: 14_397,
    tokensReturned: false,
    secretsReturned: false,
    token: PRIVATE_TOKEN,
    jwtSecret: PRIVATE_SECRET,
  }
}

function createHarness({
  args = [...CONFIRMED_ARGUMENTS],
  generated = createValidSummary(),
  generationError = null,
} = {}) {
  const state = {
    generationCalls: 0,
    stdout: '',
    stderr: '',
  }

  async function generate() {
    state.generationCalls += 1

    if (generationError) {
      throw generationError
    }

    return generated
  }

  async function run() {
    return runTokenFixtureCli({
      args,
      generate,
      writeOutput(value) {
        state.stdout += value
      },
      writeError(value) {
        state.stderr += value
      },
    })
  }

  return {
    run,
    state,
  }
}

test('runs only with exact confirmation flags and prints a safe summary', async () => {
  const harness = createHarness()

  const result = await harness.run()

  assert.deepEqual(result, {
    exitCode: 0,
    generatorCalled: true,
  })

  assert.equal(harness.state.generationCalls, 1)
  assert.equal(harness.state.stderr, '')

  const output = JSON.parse(harness.state.stdout)

  assert.deepEqual(output, {
    check: 'p2-token-fixture-cli',
    status: 'complete',
    compiledSignerReady: true,
    source: {
      hostFingerprint: '777c6ca41572',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    databaseRead: {
      isolation: 'repeatable read',
      readOnly: true,
      committed: true,
      connectionClosed: true,
    },
    artifact: {
      destination: '/tmp/tokens.json',
      bytesWritten: 1_500_000,
      fileMode: '0600',
      atomicWrite: true,
    },
    usersWritten: 8100,
    pools: {
      R: 900,
      A: 7000,
      B: 200,
    },
    tokenTtlSeconds: 14_400,
    tokenIssueSpreadSeconds: 3,
    remainingTokenSeconds: 14_397,
    tokensReturned: false,
    secretsReturned: false,
  })

  assert.equal(harness.state.stdout.includes(PRIVATE_TOKEN), false)
  assert.equal(harness.state.stdout.includes(PRIVATE_SECRET), false)
})

test('rejects missing, extra, and reordered flags before generation', async () => {
  const invalidArguments = [
    [],
    CONFIRMED_ARGUMENTS.slice(0, 2),
    [...CONFIRMED_ARGUMENTS, '--extra'],
    [CONFIRMED_ARGUMENTS[1], CONFIRMED_ARGUMENTS[0], CONFIRMED_ARGUMENTS[2]],
  ]

  for (const args of invalidArguments) {
    const harness = createHarness({ args })

    const result = await harness.run()

    assert.deepEqual(result, {
      exitCode: 1,
      generatorCalled: false,
    })

    assert.equal(harness.state.generationCalls, 0)
    assert.equal(harness.state.stdout, '')

    const failure = JSON.parse(harness.state.stderr)

    assert.equal(failure.error, 'Use the exact token fixture confirmation flags')
    assert.equal(failure.code, null)
  }
})

test('suppresses generator errors while preserving safe database codes', async () => {
  const generationError = new Error(`Generation failed with ${PRIVATE_SECRET} and ${PRIVATE_TOKEN}`)

  generationError.code = '28P01'

  const harness = createHarness({ generationError })

  const result = await harness.run()

  assert.deepEqual(result, {
    exitCode: 1,
    generatorCalled: true,
  })

  assert.equal(harness.state.stdout, '')

  const failure = JSON.parse(harness.state.stderr)

  assert.equal(failure.error, 'Token fixture generation failed')
  assert.equal(failure.code, '28P01')
  assert.equal(harness.state.stderr.includes(PRIVATE_SECRET), false)
  assert.equal(harness.state.stderr.includes(PRIVATE_TOKEN), false)
})

test('suppresses error codes that are not five safe characters', async () => {
  const generationError = new Error(PRIVATE_SECRET)

  generationError.code = 'PRIVATE_SECRET_CODE'

  const harness = createHarness({ generationError })

  const result = await harness.run()
  const failure = JSON.parse(harness.state.stderr)

  assert.equal(result.exitCode, 1)
  assert.equal(failure.code, null)
  assert.equal(harness.state.stderr.includes(PRIVATE_SECRET), false)
})

test('rejects an unsafe generator summary without printing its values', async () => {
  const generated = createValidSummary()

  generated.source.seedDate = PRIVATE_SECRET

  const harness = createHarness({ generated })

  const result = await harness.run()
  const failure = JSON.parse(harness.state.stderr)

  assert.deepEqual(result, {
    exitCode: 1,
    generatorCalled: true,
  })

  assert.equal(harness.state.stdout, '')
  assert.equal(failure.error, 'Token fixture generator returned an invalid summary')
  assert.equal(harness.state.stderr.includes(PRIVATE_SECRET), false)
})

test('rejects incomplete CLI dependencies without running generation', async () => {
  let stderr = ''

  const result = await runTokenFixtureCli({
    args: [...CONFIRMED_ARGUMENTS],
    generate: null,
    writeOutput() {},
    writeError(value) {
      stderr += value
    },
  })

  assert.deepEqual(result, {
    exitCode: 1,
    generatorCalled: false,
  })

  const failure = JSON.parse(stderr)

  assert.equal(failure.error, 'Token fixture CLI dependencies are incomplete')
})

test('direct execution rejects missing confirmation before database access', () => {
  const cliPath = fileURLToPath(new URL('./token-fixture-cli.mjs', import.meta.url))

  const execution = spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: PRIVATE_DATABASE_URL,
      JWT_SECRET: PRIVATE_SECRET,
    },
  })

  assert.equal(execution.error, undefined)
  assert.equal(execution.status, 1)
  assert.equal(execution.stdout, '')

  const failure = JSON.parse(execution.stderr)

  assert.equal(failure.error, 'Use the exact token fixture confirmation flags')

  const exposedText = `${execution.stdout}\n${execution.stderr}`

  assert.equal(exposedText.includes(PRIVATE_DATABASE_URL), false)
  assert.equal(exposedText.includes(PRIVATE_SECRET), false)
})

test('CLI source has no local env fallback or console logging path', async () => {
  const source = await readFile(new URL('./token-fixture-cli.mjs', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /\.env\.staging|dotenv/)
  assert.doesNotMatch(source, /console\.(log|error)/)
  assert.match(source, /pathToFileURL/)
  assert.match(source, /process\.exitCode/)
})
