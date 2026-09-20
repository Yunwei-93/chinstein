import assert from 'node:assert/strict'
import test from 'node:test'

import {
  P4_SOAK_WORKLOAD,
  buildP4SoakOptions,
  buildP4SoakSummary,
  readP4SoakConfig,
} from './soak-contracts.mjs'

const BASE_URL = 'https://staging.example.com'

function addWindowMetrics(metrics, window, { p95, count }) {
  const selector = `perf_phase:measured,scenario:p4_soak_${window}`
  metrics[`perf_expected_duration_ms{${selector}}`] = {
    values: { count, avg: p95 - 20, min: 80, med: p95 - 30, 'p(95)': p95, max: p95 + 20 },
  }
  metrics[`perf_unexpected_response_rate{${selector}}`] = {
    values: { rate: 0, passes: 0, fails: count },
  }
  metrics[`perf_requests_total{${selector}}`] = { values: { count } }
  metrics[`perf_expected_responses_total{${selector}}`] = { values: { count } }
}

function summaryData({ openingP95 = 280, middleP95 = 285, closingP95 = 290 } = {}) {
  const metrics = {
    'perf_expected_duration_ms{perf_phase:measured}': {
      values: { count: 54000, avg: 250, min: 80, med: 220, 'p(95)': 290, max: 400 },
    },
    'checks{perf_phase:measured}': {
      values: { rate: 1, passes: 54000, fails: 0 },
    },
    'perf_unexpected_response_rate{perf_phase:measured}': {
      values: { rate: 0, passes: 0, fails: 54000 },
    },
    'perf_requests_total{perf_phase:measured}': { values: { count: 54000 } },
    'perf_expected_responses_total{perf_phase:measured}': { values: { count: 54000 } },
  }

  addWindowMetrics(metrics, 'opening', { p95: openingP95, count: 18000 })
  addWindowMetrics(metrics, 'middle', { p95: middleP95, count: 18000 })
  addWindowMetrics(metrics, 'closing', { p95: closingP95, count: 18000 })

  return { metrics }
}

test('freezes one 30-minute S4 soak at the confirmed sustainable point', () => {
  const run = readP4SoakConfig({ PERF_BASE_URL: BASE_URL })
  const options = buildP4SoakOptions(run)

  assert.equal(run.scenarioId, 'S4')
  assert.equal(run.vus, 5)
  assert.equal(run.measuredSeconds, 1800)
  assert.deepEqual(run.windows, ['opening', 'middle', 'closing'])
  assert.equal(options.scenarios.p4_soak_warmup.duration, '30s')
  assert.equal(options.scenarios.p4_soak_opening.duration, '600s')
  assert.equal(options.scenarios.p4_soak_middle.startTime, '630s')
  assert.equal(options.scenarios.p4_soak_closing.startTime, '1230s')
})

test('rejects an unapproved target before execution', () => {
  assert.throws(() => readP4SoakConfig({ PERF_BASE_URL: 'http://staging.example.com' }), /base URL/)
})

test('accepts stable opening, middle, and closing windows', () => {
  const run = readP4SoakConfig({ PERF_BASE_URL: BASE_URL })
  const summary = buildP4SoakSummary(run, summaryData())

  assert.equal(summary.overall.measuredAttempted, 54000)
  assert.equal(summary.overall.measuredUnexpected, 0)
  assert.equal(summary.windows.length, 3)
  assert.equal(summary.p95GrowthPercent > 0, true)
  assert.equal(summary.stabilityFailed, false)
})

test('fails closed when closing latency drifts beyond the frozen limit', () => {
  const run = readP4SoakConfig({ PERF_BASE_URL: BASE_URL })
  const summary = buildP4SoakSummary(
    run,
    summaryData({ openingP95: 250, middleP95: 290, closingP95: 340 }),
  )

  assert.equal(summary.p95GrowthRatio > P4_SOAK_WORKLOAD.maximumP95GrowthRatio, true)
  assert.equal(summary.stabilityFailed, true)
})

test('fails closed when closing throughput falls below the frozen retention limit', () => {
  const run = readP4SoakConfig({ PERF_BASE_URL: BASE_URL })
  const data = summaryData()

  data.metrics['perf_requests_total{perf_phase:measured,scenario:p4_soak_closing}'].values.count =
    14000
  data.metrics[
    'perf_expected_responses_total{perf_phase:measured,scenario:p4_soak_closing}'
  ].values.count = 14000

  const summary = buildP4SoakSummary(run, data)

  assert.equal(
    summary.throughputRetentionRatio < P4_SOAK_WORKLOAD.minimumThroughputRetentionRatio,
    true,
  )
  assert.equal(summary.stabilityFailed, true)
})
