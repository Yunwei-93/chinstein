import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  BASELINE_SCENARIOS,
  P2_LEVELS,
  P2_REPETITIONS,
  P2_WRITE_WORKLOAD,
} from './baseline-config.mjs'
import { getBaselineScenario } from './baseline-contracts.mjs'
import {
  buildScenarioRunOptions,
  executeScenarioRunIteration,
  readScenarioRunConfig,
  resolveScenarioIteration,
} from './k6/scenario-run-contracts.mjs'

const BASE_URL = 'https://staging.example.invalid'
const PRIVATE_TOKEN = 'private-bearer-token'
const PRIVATE_PASSWORD = 'P'.repeat(32)
const PRIVATE_ANSWER = 'private-daily-answer'
const PRIVATE_ERROR = 'private-runtime-error'

const metadata = Object.freeze({
  login: Object.freeze({
    sequence: 1,
    email: 'player_00001@example.invalid',
  }),
  dailyCharacter: Object.freeze({
    id: 274,
    answer: PRIVATE_ANSWER,
  }),
})

function createEnvironment(overrides = {}) {
  return {
    PERF_P2_SCENARIO_ID: 'S2',
    PERF_P2_VUS: '1',
    PERF_P2_REPETITION: '1',
    PERF_BASE_URL: BASE_URL,
    ...overrides,
  }
}

function createRun({ scenarioId = 'S2', vus = 1, repetition = 1, baseUrl = BASE_URL } = {}) {
  return readScenarioRunConfig({
    PERF_P2_SCENARIO_ID: scenarioId,
    PERF_P2_VUS: String(vus),
    PERF_P2_REPETITION: String(repetition),
    PERF_BASE_URL: baseUrl,
  })
}

function createHarness({ failStage = null, transformMetricSummary = null } = {}) {
  const calls = []

  const state = {
    tokenLookup: null,
    httpInput: null,
    metricOutcome: null,
  }

  function failIfRequested(stage) {
    if (failStage === stage) {
      throw new Error(`${PRIVATE_ERROR}:${PRIVATE_TOKEN}:${PRIVATE_PASSWORD}`)
    }
  }

  const dependencies = {
    getFixtureMetadata() {
      calls.push('fixture')
      failIfRequested('fixture')

      return metadata
    },

    getTokenUserBySequence(sequence, pool) {
      calls.push('token')
      failIfRequested('token')

      state.tokenLookup = {
        sequence,
        pool,
      }

      return {
        sequence,
        userId: sequence + 10000,
        pool,
        token: PRIVATE_TOKEN,
        issuedAt: 1_800_000_000,
        expiresAt: 1_800_014_400,
      }
    },

    readLoginPassword() {
      calls.push('password')
      failIfRequested('password')

      return PRIVATE_PASSWORD
    },

    executeScenarioHttpRequest(input) {
      calls.push('http')
      failIfRequested('http')

      state.httpInput = input

      return {
        scenarioId: input.plan.scenarioId,
        phase: input.phase,
        userSequence: input.plan.userSequence,
        expected: true,
        category: 'expected',
        status: input.plan.expectation.status,
        reasons: [],
        durationMs: 12.5,
        responseBytes: 240,
        requestAttempted: true,
        transportCompleted: true,
        secretsReturned: false,
      }
    },

    recordScenarioMetrics(outcome) {
      calls.push('metrics')
      failIfRequested('metrics')

      state.metricOutcome = outcome

      const summary = {
        scenarioId: outcome.scenarioId,
        phase: outcome.phase,
        expected: outcome.expected,
        category: outcome.category,
        status: outcome.status,
        durationRecorded: outcome.expected,
        responseBytes: outcome.responseBytes,
        requestAttempted: true,
        transportCompleted: outcome.transportCompleted,
        reasonCount: outcome.reasons.length,
        secretsReturned: false,
        checkPassed: outcome.expected,
      }

      return typeof transformMetricSummary === 'function'
        ? transformMetricSummary(summary)
        : summary
    },
  }

  return {
    calls,
    state,
    dependencies,
  }
}

test('builds all 42 approved P2 run definitions', () => {
  let approvedRuns = 0

  for (const scenario of BASELINE_SCENARIOS) {
    for (const vus of P2_LEVELS) {
      for (let repetition = 1; repetition <= P2_REPETITIONS; repetition += 1) {
        const run = createRun({
          scenarioId: scenario.id,
          vus,
          repetition,
        })

        const options = buildScenarioRunOptions(run)
        const execution = options.scenarios.p2_baseline

        assert.equal(run.scenarioId, scenario.id)
        assert.equal(run.workload, scenario.workload)
        assert.equal(run.vus, vus)
        assert.equal(run.repetition, repetition)
        assert.equal(run.baseUrl, BASE_URL)

        assert.equal(execution.exec, 'runP2Scenario')
        assert.equal(execution.vus, vus)
        assert.equal(execution.tags.perf_run_scenario, scenario.id)
        assert.equal(execution.tags.perf_run_vus, String(vus))
        assert.equal(execution.tags.perf_run_repetition, String(repetition))

        if (scenario.id === 'S5') {
          assert.equal(execution.executor, 'shared-iterations')
          assert.equal(
            execution.iterations,
            P2_WRITE_WORKLOAD.warmupIterations + P2_WRITE_WORKLOAD.measuredIterations,
          )
          assert.equal(execution.maxDuration, '10m')
        } else {
          assert.equal(execution.executor, 'constant-vus')
          assert.equal(execution.duration, '90s')
        }

        assert.deepEqual(options.thresholds, {
          'perf_unexpected_response_rate{perf_phase:measured}': [
            {
              threshold: 'rate<0.01',
              abortOnFail: false,
            },
          ],
          'perf_expected_duration_ms{perf_phase:measured}': [
            {
              threshold: 'p(95)>=0',
              abortOnFail: false,
            },
          ],
          'perf_response_bytes{perf_phase:measured}': [
            {
              threshold: 'p(95)>=0',
              abortOnFail: false,
            },
          ],
        })

        assert.deepEqual(options.summaryTrendStats, ['count', 'avg', 'min', 'med', 'p(95)', 'max'])

        assert.deepEqual(options.systemTags, [
          'status',
          'method',
          'name',
          'scenario',
          'expected_response',
          'error',
          'error_code',
        ])

        approvedRuns += 1
      }
    }
  }

  assert.equal(approvedRuns, 42)
})

test('rejects invalid and noncanonical run configuration', () => {
  const invalidEnvironments = [
    createEnvironment({
      PERF_P2_SCENARIO_ID: undefined,
    }),
    createEnvironment({
      PERF_P2_SCENARIO_ID: 'S7',
    }),
    createEnvironment({
      PERF_P2_VUS: '2',
    }),
    createEnvironment({
      PERF_P2_VUS: '01',
    }),
    createEnvironment({
      PERF_P2_VUS: ' 1 ',
    }),
    createEnvironment({
      PERF_P2_REPETITION: '0',
    }),
    createEnvironment({
      PERF_P2_REPETITION: '4',
    }),
    createEnvironment({
      PERF_P2_REPETITION: '01',
    }),
    createEnvironment({
      PERF_BASE_URL: 'http://staging.example.invalid',
    }),
    createEnvironment({
      PERF_BASE_URL: 'https://staging.example.invalid/api/health',
    }),
  ]

  assert.throws(() => readScenarioRunConfig(null), /Invalid PERF-P2 scenario run/)

  for (const environment of invalidEnvironments) {
    assert.throws(() => readScenarioRunConfig(environment), /Invalid PERF-P2 scenario run/)
  }
})

test('resolves the exact timed warmup and measured boundaries', () => {
  const run = createRun({
    scenarioId: 'S2',
    vus: 5,
  })

  const resolveAt = (elapsedMs) =>
    resolveScenarioIteration({
      run,
      virtualUserId: 5,
      iterationInScenario: 12,
      elapsedMs,
    })

  assert.deepEqual(resolveAt(0), {
    phase: 'warmup',
    writeSequence: null,
  })

  assert.deepEqual(resolveAt(29_999), {
    phase: 'warmup',
    writeSequence: null,
  })

  assert.deepEqual(resolveAt(30_000), {
    phase: 'measured',
    writeSequence: null,
  })

  assert.deepEqual(resolveAt(89_999), {
    phase: 'measured',
    writeSequence: null,
  })

  assert.equal(resolveAt(90_000), null)
})

test('rejects invalid execution coordinates', () => {
  const run = createRun({
    scenarioId: 'S2',
    vus: 5,
  })

  const invalidCoordinates = [
    {
      virtualUserId: 0,
      iterationInScenario: 0,
      elapsedMs: 0,
    },
    {
      virtualUserId: 6,
      iterationInScenario: 0,
      elapsedMs: 0,
    },
    {
      virtualUserId: 1,
      iterationInScenario: -1,
      elapsedMs: 0,
    },
    {
      virtualUserId: 1,
      iterationInScenario: 0,
      elapsedMs: -1,
    },
  ]

  for (const coordinates of invalidCoordinates) {
    assert.throws(
      () =>
        resolveScenarioIteration({
          run,
          ...coordinates,
        }),
      /Invalid PERF-P2 scenario run/,
    )
  }
})

test('maps all six S5 rounds to 330 unique reserve users', () => {
  const sequences = []

  for (const vus of P2_LEVELS) {
    for (let repetition = 1; repetition <= P2_REPETITIONS; repetition += 1) {
      const run = createRun({
        scenarioId: 'S5',
        vus,
        repetition,
      })

      for (let iterationInScenario = 0; iterationInScenario < 55; iterationInScenario += 1) {
        const coordinate = resolveScenarioIteration({
          run,
          virtualUserId: (iterationInScenario % vus) + 1,
          iterationInScenario,
          elapsedMs: 0,
        })

        assert.equal(coordinate.phase, iterationInScenario < 5 ? 'warmup' : 'measured')

        sequences.push(coordinate.writeSequence)
      }
    }
  }

  const sortedSequences = [...sequences].sort((left, right) => left - right)

  assert.equal(sequences.length, 330)
  assert.equal(new Set(sequences).size, 330)

  assert.deepEqual(
    sortedSequences,
    Array.from({ length: 330 }, (_, index) => 7301 + index),
  )
})

test('runs health without reading credentials', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S0',
      }),
      virtualUserId: 1,
      iterationInScenario: 0,
      elapsedMs: 30_000,
    },
    harness.dependencies,
  )

  assert.deepEqual(harness.calls, ['fixture', 'http', 'metrics'])

  assert.equal(harness.state.httpInput.tokenUser, null)
  assert.equal(harness.state.httpInput.loginPassword, null)

  assert.equal(summary.executed, true)
  assert.equal(summary.scenarioId, 'S0')
  assert.equal(summary.phase, 'measured')
  assert.equal(summary.expected, true)
})

test('passes the login password only to S1 HTTP execution', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S1',
      }),
      virtualUserId: 1,
      iterationInScenario: 0,
      elapsedMs: 30_000,
    },
    harness.dependencies,
  )

  assert.deepEqual(harness.calls, ['fixture', 'password', 'http', 'metrics'])

  assert.equal(harness.state.httpInput.loginPassword, PRIVATE_PASSWORD)

  assert.equal(harness.state.httpInput.tokenUser, null)
  assert.equal(summary.scenarioId, 'S1')

  const serializedSummary = JSON.stringify(summary)

  assert.equal(serializedSummary.includes(PRIVATE_PASSWORD), false)
  assert.equal(serializedSummary.includes(metadata.login.email), false)
})

test('looks up the exact planned bearer identity and pool', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S2',
        vus: 5,
      }),
      virtualUserId: 2,
      iterationInScenario: 10,
      elapsedMs: 30_000,
    },
    harness.dependencies,
  )

  assert.deepEqual(harness.calls, ['fixture', 'token', 'http', 'metrics'])

  assert.deepEqual(harness.state.tokenLookup, {
    sequence: 2,
    pool: 'R',
  })

  assert.equal(harness.state.httpInput.tokenUser.sequence, 2)
  assert.equal(harness.state.httpInput.tokenUser.pool, 'R')
  assert.equal(summary.scenarioId, 'S2')

  const serializedSummary = JSON.stringify(summary)

  assert.equal(serializedSummary.includes(PRIVATE_TOKEN), false)
  assert.equal(serializedSummary.includes(PRIVATE_ANSWER), false)
})

test('derives the S5 write user inside the runner', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S5',
        vus: 5,
        repetition: 2,
      }),
      virtualUserId: 1,
      iterationInScenario: 5,
      elapsedMs: 0,
    },
    harness.dependencies,
  )

  assert.deepEqual(harness.state.tokenLookup, {
    sequence: 7526,
    pool: 'A',
  })

  assert.equal(harness.state.httpInput.plan.userSequence, 7526)
  assert.equal(harness.state.httpInput.phase, 'measured')
  assert.equal(summary.expected, true)
})

test('does not execute after the timed run window closes', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S3',
      }),
      virtualUserId: 1,
      iterationInScenario: 20,
      elapsedMs: 90_000,
    },
    harness.dependencies,
  )

  assert.deepEqual(harness.calls, [])

  assert.deepEqual(summary, {
    executed: false,
    scenarioId: 'S3',
    phase: null,
    secretsReturned: false,
  })
})

test('rejects incomplete adapters before fixture or HTTP access', () => {
  const harness = createHarness()
  const incomplete = {
    ...harness.dependencies,
  }

  delete incomplete.recordScenarioMetrics

  assert.throws(
    () =>
      executeScenarioRunIteration(
        {
          run: createRun({
            scenarioId: 'S2',
          }),
          virtualUserId: 1,
          iterationInScenario: 0,
          elapsedMs: 0,
        },
        incomplete,
      ),
    /runtime dependency recordScenarioMetrics is unavailable/,
  )

  assert.deepEqual(harness.calls, [])
})

test('suppresses raw dependency failures', () => {
  const harness = createHarness({
    failStage: 'token',
  })

  assert.throws(
    () =>
      executeScenarioRunIteration(
        {
          run: createRun({
            scenarioId: 'S2',
          }),
          virtualUserId: 1,
          iterationInScenario: 0,
          elapsedMs: 0,
        },
        harness.dependencies,
      ),
    (error) => {
      assert.match(error.message, /token lookup failed/)

      assert.equal(error.message.includes(PRIVATE_ERROR), false)
      assert.equal(error.message.includes(PRIVATE_TOKEN), false)
      assert.equal(error.message.includes(PRIVATE_PASSWORD), false)

      return true
    },
  )

  assert.deepEqual(harness.calls, ['fixture', 'token'])
})

test('rejects an unsafe metric summary without returning it', () => {
  const harness = createHarness({
    transformMetricSummary(summary) {
      return {
        ...summary,
        token: PRIVATE_TOKEN,
      }
    },
  })

  assert.throws(
    () =>
      executeScenarioRunIteration(
        {
          run: createRun({
            scenarioId: 'S2',
          }),
          virtualUserId: 1,
          iterationInScenario: 0,
          elapsedMs: 30_000,
        },
        harness.dependencies,
      ),
    (error) => {
      assert.match(error.message, /metric summary has an invalid shape/)

      assert.equal(error.message.includes(PRIVATE_TOKEN), false)

      return true
    },
  )
})

test('k6 runtime uses only the approved execution boundaries', async () => {
  const source = await readFile(new URL('./k6/scenario-run-runtime.js', import.meta.url), 'utf8')

  assert.match(source, /from\s+['"]k6\/execution['"]/)

  assert.match(source, /readScenarioRunConfig\(__ENV\)/)

  assert.match(source, /exec\.vu\.idInTest/)

  assert.match(source, /exec\.scenario\.iterationInTest/)

  assert.match(source, /exec\.scenario\.startTime/)

  assert.match(source, /__ENV\.PERF_LOGIN_PASSWORD/)

  assert.match(source, /exec\.test\.abort/)

  assert.match(source, /export function handleSummary/)

  assert.match(source, /PERF_RESULT/)

  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /DATABASE_URL/)
  assert.doesNotMatch(source, /JWT_SECRET/)
  assert.doesNotMatch(source, /\.env/)
  assert.doesNotMatch(source, /node:fs/)
  assert.doesNotMatch(source, /child_process/)
})

test('safe run summaries exclude private execution values', () => {
  const harness = createHarness()

  const summary = executeScenarioRunIteration(
    {
      run: createRun({
        scenarioId: 'S6',
      }),
      virtualUserId: 1,
      iterationInScenario: 0,
      elapsedMs: 30_000,
    },
    harness.dependencies,
  )

  const serialized = JSON.stringify(summary)

  for (const forbidden of [
    PRIVATE_TOKEN,
    PRIVATE_PASSWORD,
    PRIVATE_ANSWER,
    metadata.login.email,
    BASE_URL,
    '"userSequence"',
    '"reasons"',
    '"body"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} escaped into the run summary`)
  }
})
