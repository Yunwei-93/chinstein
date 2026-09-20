import assert from 'node:assert/strict'
import test from 'node:test'

import { POOL_A_ALLOCATIONS } from '../p2/baseline-config.mjs'

import {
  P3_WRITE_ITERATIONS,
  P3_WRITE_LEVELS,
  P3_WRITE_REPETITIONS,
  buildP3WriteRequestPlan,
  buildP3WriteRunOptions,
  buildP3WriteSummary,
  readP3WriteRunConfig,
  selectP3WriteSequence,
} from './write-contracts.mjs'

const BASE_URL = 'https://staging.example.com'

function environment(overrides = {}) {
  return {
    PERF_P3_VUS: '5',
    PERF_P3_REPETITION: '1',
    PERF_BASE_URL: BASE_URL,
    ...overrides,
  }
}

test('allocates exactly 3,000 distinct baseline Pool A users', () => {
  const sequences = []

  for (let repetition = 1; repetition <= P3_WRITE_REPETITIONS; repetition += 1) {
    for (const vus of P3_WRITE_LEVELS) {
      for (let iteration = 0; iteration < P3_WRITE_ITERATIONS; iteration += 1) {
        sequences.push(selectP3WriteSequence({ vus, repetition, iteration }))
      }
    }
  }

  assert.equal(sequences.length, 3_000)
  assert.equal(new Set(sequences).size, 3_000)
  assert.equal(sequences[0], POOL_A_ALLOCATIONS.baselineIsolated.firstSeq)
  assert.equal(sequences.at(-1), POOL_A_ALLOCATIONS.baselineIsolated.lastSeq)
})

test('rejects write coordinates outside the frozen ladder', () => {
  assert.throws(
    () => selectP3WriteSequence({ vus: 1, repetition: 1, iteration: 0 }),
    /VU level is outside/,
  )
  assert.throws(
    () => selectP3WriteSequence({ vus: 5, repetition: 4, iteration: 0 }),
    /repetition is outside/,
  )
  assert.throws(
    () => selectP3WriteSequence({ vus: 5, repetition: 1, iteration: 200 }),
    /iteration is outside/,
  )
})

test('reads canonical write coordinates and builds a 200-iteration run', () => {
  const run = readP3WriteRunConfig(environment({ PERF_P3_VUS: '80', PERF_P3_REPETITION: '3' }))
  const options = buildP3WriteRunOptions(run)

  assert.deepEqual(run, {
    scenarioId: 'S5',
    vus: 80,
    repetition: 3,
    baseUrl: BASE_URL,
    p95ThresholdMs: 50,
  })
  assert.equal(options.scenarios.p3_write.executor, 'shared-iterations')
  assert.equal(options.scenarios.p3_write.iterations, 200)
  assert.equal(options.scenarios.p3_write.vus, 80)

  for (const invalid of [
    { PERF_P3_VUS: '1' },
    { PERF_P3_VUS: '05' },
    { PERF_P3_REPETITION: '4' },
    { PERF_BASE_URL: 'http://staging.example.com' },
  ]) {
    assert.throws(() => readP3WriteRunConfig(environment(invalid)), /Invalid PERF-P3/)
  }
})

test('builds the approved S5 request without private values', () => {
  const plan = buildP3WriteRequestPlan({
    sequence: 901,
    metadata: {
      dailyCharacter: {
        id: 274,
        answer: 'synthetic-answer',
      },
    },
  })

  assert.equal(plan.scenarioId, 'S5')
  assert.equal(plan.userSequence, 901)
  assert.equal(plan.expectation.expectedCharacterId, 274)
  assert.equal(JSON.stringify(plan).includes('token'), false)
})

test('builds a compact finite-batch result', () => {
  const run = readP3WriteRunConfig(environment())
  const summary = buildP3WriteSummary(run, {
    state: { testRunDurationMs: 4_000 },
    metrics: {
      'perf_expected_duration_ms{perf_phase:measured}': {
        values: { count: 200, avg: 12, min: 8, med: 11, 'p(95)': 20, max: 30 },
      },
      'perf_response_bytes{perf_phase:measured}': {
        values: { count: 200, avg: 105, min: 105, med: 105, 'p(95)': 105, max: 105 },
      },
      'checks{perf_phase:measured}': { values: { rate: 1, passes: 200, fails: 0 } },
      'perf_unexpected_response_rate{perf_phase:measured}': {
        values: { rate: 0, passes: 0, fails: 200 },
      },
      'perf_requests_total{perf_phase:measured}': { values: { count: 200 } },
      'perf_expected_responses_total{perf_phase:measured}': { values: { count: 200 } },
    },
  })

  assert.equal(summary.label, 'p3-S5-vu5-rep1')
  assert.equal(summary.finiteBatchCompletionRate, 1)
  assert.equal(summary.completionTimeMs, 4_000)
  assert.equal(summary.measuredUnexpected, 0)
  assert.equal(summary.p95ThresholdExceeded, false)
})
