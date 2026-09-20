import assert from 'node:assert/strict'
import test from 'node:test'

import { POOL_A_ALLOCATIONS } from '../p2/baseline-config.mjs'

import {
  P3_MIXED_WORKLOAD,
  buildP3MixedRunOptions,
  buildP3MixedSummary,
  buildP3MixedWriteRequestPlan,
  readP3MixedRunConfig,
  resolveP3MixedReadPhase,
  selectP3MixedWriteSequence,
} from './mixed-contracts.mjs'

const BASE_URL = 'https://staging.example.com'

test('freezes one attributable S4 and S5 mixed workload', () => {
  const run = readP3MixedRunConfig({ PERF_BASE_URL: BASE_URL })
  const options = buildP3MixedRunOptions(run)

  assert.equal(run.readScenarioId, 'S4')
  assert.equal(run.readVus, 5)
  assert.equal(run.writeIterations, 200)
  assert.equal(options.scenarios.p3_mixed_read.vus, 5)
  assert.equal(options.scenarios.p3_mixed_read.duration, '150s')
  assert.equal(options.scenarios.p3_mixed_write.rate, 100)
  assert.equal(options.scenarios.p3_mixed_write.timeUnit, '60s')
  assert.equal(options.scenarios.p3_mixed_write.startTime, '30s')
  assert.equal(options.thresholds['dropped_iterations{scenario:p3_mixed_write}'][0].threshold, 'count==0')
})

test('uses each baseline mixed user exactly once', () => {
  const sequences = Array.from({ length: P3_MIXED_WORKLOAD.writeIterations }, (_, iteration) =>
    selectP3MixedWriteSequence(iteration),
  )

  assert.equal(sequences[0], POOL_A_ALLOCATIONS.baselineMixed.firstSeq)
  assert.equal(sequences.at(-1), POOL_A_ALLOCATIONS.baselineMixed.lastSeq)
  assert.equal(new Set(sequences).size, 200)
  assert.throws(() => selectP3MixedWriteSequence(200), /outside/)
})

test('builds an approved mixed write without private values', () => {
  const plan = buildP3MixedWriteRequestPlan({
    sequence: POOL_A_ALLOCATIONS.baselineMixed.firstSeq,
    metadata: { dailyCharacter: { id: 276, answer: 'synthetic-answer' } },
  })

  assert.equal(plan.scenarioId, 'S5')
  assert.equal(plan.userSequence, 6901)
  assert.equal(plan.expectation.expectedCharacterId, 276)
  assert.equal(JSON.stringify(plan).includes('token'), false)
})

test('separates mixed read warmup and measurement', () => {
  assert.equal(resolveP3MixedReadPhase(0), 'warmup')
  assert.equal(resolveP3MixedReadPhase(29_999), 'warmup')
  assert.equal(resolveP3MixedReadPhase(30_000), 'measured')
  assert.equal(resolveP3MixedReadPhase(149_999), 'measured')
  assert.equal(resolveP3MixedReadPhase(150_000), null)
})

test('builds a compact mixed result with separate read and write evidence', () => {
  const run = readP3MixedRunConfig({ PERF_BASE_URL: BASE_URL })
  const values = { count: 200, avg: 20, min: 10, med: 18, 'p(95)': 30, max: 40 }
  const metrics = {}

  for (const scenario of ['S4', 'S5']) {
    const tags = `perf_phase:measured,perf_scenario:${scenario}`
    metrics[`perf_expected_duration_ms{${tags}}`] = { values }
    metrics[`perf_response_bytes{${tags}}`] = { values }
    metrics[`checks{${tags}}`] = { values: { rate: 1, passes: 200, fails: 0 } }
    metrics[`perf_unexpected_response_rate{${tags}}`] = {
      values: { rate: 0, passes: 0, fails: 200 },
    }
    metrics[`perf_requests_total{${tags}}`] = { values: { count: 200 } }
    metrics[`perf_expected_responses_total{${tags}}`] = { values: { count: 200 } }
  }

  metrics['dropped_iterations{scenario:p3_mixed_write}'] = { values: { count: 0 } }

  const summary = buildP3MixedSummary(run, { metrics })

  assert.equal(summary.label, 'p3-S7-mixed-baseline')
  assert.equal(summary.read.scenarioId, 'S4')
  assert.equal(summary.write.scenarioId, 'S5')
  assert.equal(summary.successfulWriteUsers, 200)
  assert.equal(summary.readP95ThresholdExceeded, false)
  assert.equal(summary.writeP95ThresholdExceeded, false)
  assert.equal(summary.mixedRunFailed, false)
})
