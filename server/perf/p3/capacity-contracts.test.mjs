import assert from 'node:assert/strict'
import test from 'node:test'

import {
  P3_CAPACITY_LEVELS,
  P3_P95_THRESHOLDS_MS,
  P3_TIMED_WORKLOAD,
  buildP3CapacityRunOptions,
  buildP3CapacitySummary,
  getP3CapacityLevels,
  readP3CapacityRunConfig,
  resolveP3CapacityPhase,
} from './capacity-contracts.mjs'

function environment(overrides = {}) {
  return {
    PERF_P3_SCENARIO_ID: 'S0',
    PERF_P3_VUS: '1',
    PERF_P3_RUN_KIND: 'initial',
    PERF_BASE_URL: 'https://staging.example.com',
    ...overrides,
  }
}

test('freezes the approved timed ladders and P2-derived p95 thresholds', () => {
  assert.deepEqual(P3_CAPACITY_LEVELS.S0, [1, 2, 5, 10, 20, 40, 80])
  assert.deepEqual(P3_CAPACITY_LEVELS.S4, [1, 2, 5, 10, 20, 40, 80])
  assert.deepEqual(P3_CAPACITY_LEVELS.S1, [1, 2, 5, 8])

  for (const scenarioId of ['S2', 'S3', 'S6']) {
    assert.deepEqual(getP3CapacityLevels(scenarioId), [5, 10, 20, 40, 80])
  }

  assert.deepEqual(P3_P95_THRESHOLDS_MS, {
    S0: 50,
    S1: 550,
    S2: 100,
    S3: 50,
    S4: 350,
    S6: 150,
  })
  assert.deepEqual(P3_TIMED_WORKLOAD, { warmupSeconds: 30, measuredSeconds: 120 })
})

test('reads only canonical scenario levels and run kinds', () => {
  assert.deepEqual(readP3CapacityRunConfig(environment()), {
    scenarioId: 'S0',
    vus: 1,
    runKind: 'initial',
    baseUrl: 'https://staging.example.com',
    p95ThresholdMs: 50,
  })

  assert.equal(
    readP3CapacityRunConfig(
      environment({
        PERF_P3_SCENARIO_ID: 'S4',
        PERF_P3_VUS: '80',
        PERF_P3_RUN_KIND: 'confirmation',
      }),
    ).vus,
    80,
  )

  for (const invalid of [
    { PERF_P3_SCENARIO_ID: 'S5' },
    { PERF_P3_SCENARIO_ID: 'S3', PERF_P3_VUS: '2' },
    { PERF_P3_VUS: '01' },
    { PERF_P3_RUN_KIND: 'retry' },
    { PERF_BASE_URL: 'http://staging.example.com' },
  ]) {
    assert.throws(() => readP3CapacityRunConfig(environment(invalid)), /Invalid PERF-P3/)
  }
})

test('builds one non-aborting 30-second plus 120-second capacity run', () => {
  const run = readP3CapacityRunConfig(environment())
  const options = buildP3CapacityRunOptions(run)

  assert.equal(options.scenarios.p3_capacity.duration, '150s')
  assert.equal(options.scenarios.p3_capacity.vus, 1)
  assert.equal(options.scenarios.p3_capacity.exec, 'runP3CapacityScenario')
  assert.deepEqual(options.thresholds['perf_expected_duration_ms{perf_phase:measured}'], [
    { threshold: 'p(95)<=50', abortOnFail: false },
  ])
  assert.deepEqual(options.thresholds['checks{perf_phase:measured}'], [
    { threshold: 'rate>=0', abortOnFail: false },
  ])
  assert.deepEqual(
    options.thresholds[
      'perf_unexpected_responses_total{perf_phase:measured,perf_category:server-error}'
    ],
    [{ threshold: 'count>=0', abortOnFail: false }],
  )
})

test('separates warm-up, measured traffic, and the closed run boundary', () => {
  assert.equal(resolveP3CapacityPhase(0), 'warmup')
  assert.equal(resolveP3CapacityPhase(29_999), 'warmup')
  assert.equal(resolveP3CapacityPhase(30_000), 'measured')
  assert.equal(resolveP3CapacityPhase(149_999), 'measured')
  assert.equal(resolveP3CapacityPhase(150_000), null)
  assert.throws(() => resolveP3CapacityPhase(-1), /elapsed time is invalid/)
})

test('builds the compact result needed for capacity-knee classification', () => {
  const run = readP3CapacityRunConfig(environment())
  const summary = buildP3CapacitySummary(run, {
    metrics: {
      'perf_expected_duration_ms{perf_phase:measured}': {
        values: { count: 100, avg: 10, min: 5, med: 9, 'p(95)': 60, max: 80 },
      },
      'perf_response_bytes{perf_phase:measured}': {
        values: { count: 100, avg: 49, min: 49, med: 49, 'p(95)': 49, max: 49 },
      },
      'perf_unexpected_response_rate{perf_phase:measured}': {
        values: { rate: 0.01, passes: 1, fails: 99 },
      },
      'checks{perf_phase:measured}': { values: { rate: 0.99, passes: 99, fails: 1 } },
      'perf_requests_total{perf_phase:measured}': { values: { count: 100 } },
      'perf_expected_responses_total{perf_phase:measured}': { values: { count: 99 } },
      'perf_unexpected_responses_total{perf_phase:measured,perf_category:server-error}': {
        values: { count: 1 },
      },
    },
  })

  assert.equal(summary.label, 'p3-S0-vu1-initial')
  assert.equal(summary.measuredUnexpected, 1)
  assert.equal(summary.completedExpectedPerSecond, 0.825)
  assert.equal(summary.checks.fails, 1)
  assert.equal(summary.unexpectedByCategory['server-error'], 1)
  assert.equal(summary.unexpectedByCategory['rate-limited'], 0)
  assert.equal(summary.p95ThresholdExceeded, true)
  assert.equal(summary.errorBudgetExceeded, true)
  assert.equal(JSON.stringify(summary).includes('staging.example.com'), false)
})
