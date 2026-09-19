import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildScenarioMetricRecord,
  recordScenarioMetrics,
} from './k6/scenario-metrics-contracts.mjs'

const PRIVATE_REASON = 'private-token-and-password-must-not-escape'

function validOutcome(overrides = {}) {
  return {
    scenarioId: 'S2',
    phase: 'measured',
    userSequence: 1,
    expected: true,
    category: 'expected',
    status: 200,
    reasons: [],
    durationMs: 18.5,
    responseBytes: 240,
    requestAttempted: true,
    transportCompleted: true,
    secretsReturned: false,
    ...overrides,
  }
}

function createMetric() {
  const events = []

  return {
    events,

    add(value, tags) {
      events.push({
        value,
        tags,
      })
    },
  }
}

function createMetricAdapter() {
  return {
    attempted: createMetric(),
    expected: createMetric(),
    unexpected: createMetric(),
    unexpectedRate: createMetric(),
    expectedDuration: createMetric(),
    responseBytes: createMetric(),
  }
}

function createCheckFunction(calls) {
  return (value, checks, tags) => {
    const results = Object.values(checks).map((predicate) => predicate(value))

    calls.push({
      value,
      tags,
      results,
    })

    return results.every(Boolean)
  }
}

test('builds an allowlisted expected-response metric record', () => {
  const record = buildScenarioMetricRecord(validOutcome())

  assert.deepEqual(record.tags, {
    perf_scenario: 'S2',
    perf_phase: 'measured',
    perf_category: 'expected',
    perf_pool: 'R',
    expected_status: '200',
    actual_status: '200',
  })

  assert.equal(record.expected, true)
  assert.equal(record.durationMs, 18.5)
  assert.equal(record.responseBytes, 240)

  assert.deepEqual(record.summary, {
    scenarioId: 'S2',
    phase: 'measured',
    expected: true,
    category: 'expected',
    status: 200,
    durationRecorded: true,
    responseBytes: 240,
    requestAttempted: true,
    transportCompleted: true,
    reasonCount: 0,
    secretsReturned: false,
  })
})

test('records expected responses in the expected-duration trend', () => {
  const metrics = createMetricAdapter()
  const checkCalls = []

  const summary = recordScenarioMetrics({
    outcome: validOutcome(),
    metrics,
    checkFunction: createCheckFunction(checkCalls),
  })

  assert.equal(metrics.attempted.events.length, 1)
  assert.equal(metrics.expected.events.length, 1)
  assert.equal(metrics.unexpected.events.length, 0)
  assert.equal(metrics.unexpectedRate.events[0].value, false)
  assert.equal(metrics.expectedDuration.events[0].value, 18.5)
  assert.equal(metrics.responseBytes.events[0].value, 240)

  assert.equal(checkCalls.length, 1)
  assert.deepEqual(checkCalls[0].results, [true])
  assert.equal(summary.checkPassed, true)
})

test('records unexpected responses without contaminating latency', () => {
  const metrics = createMetricAdapter()
  const checkCalls = []

  const summary = recordScenarioMetrics({
    outcome: validOutcome({
      expected: false,
      category: 'unauthorized',
      status: 401,
      reasons: ['expected status 200, received 401'],
      durationMs: 9,
    }),
    metrics,
    checkFunction: createCheckFunction(checkCalls),
  })

  assert.equal(metrics.attempted.events.length, 1)
  assert.equal(metrics.expected.events.length, 0)
  assert.equal(metrics.unexpected.events.length, 1)
  assert.equal(metrics.unexpectedRate.events[0].value, true)
  assert.equal(metrics.expectedDuration.events.length, 0)
  assert.equal(metrics.responseBytes.events[0].value, 240)

  assert.deepEqual(checkCalls[0].results, [false])
  assert.equal(summary.checkPassed, false)
  assert.equal(summary.durationRecorded, false)
})

test('keeps warmup and measured metrics separated by tags', () => {
  const warmup = buildScenarioMetricRecord(
    validOutcome({
      phase: 'warmup',
    }),
  )

  const measured = buildScenarioMetricRecord(
    validOutcome({
      phase: 'measured',
    }),
  )

  assert.equal(warmup.tags.perf_phase, 'warmup')
  assert.equal(measured.tags.perf_phase, 'measured')

  assert.deepEqual(
    {
      ...warmup.tags,
      perf_phase: 'measured',
    },
    measured.tags,
  )
})

test('transport errors remain countable but have no latency sample', () => {
  const record = buildScenarioMetricRecord(
    validOutcome({
      expected: false,
      category: 'transport-error',
      status: 0,
      reasons: ['expected status 200, received 0'],
      durationMs: 0,
      responseBytes: 0,
      transportCompleted: false,
    }),
  )

  assert.equal(record.expected, false)
  assert.equal(record.durationMs, null)
  assert.equal(record.tags.actual_status, '0')
  assert.equal(record.summary.transportCompleted, false)
})

test('raw reason text and user identities never enter metric output', () => {
  const record = buildScenarioMetricRecord(
    validOutcome({
      expected: false,
      category: 'server-error',
      status: 500,
      reasons: [PRIVATE_REASON],
    }),
  )

  const serialized = JSON.stringify(record)

  assert.equal(serialized.includes(PRIVATE_REASON), false)
  assert.equal(serialized.includes('"userSequence"'), false)
  assert.equal(serialized.includes('"reasons"'), false)
  assert.equal(record.summary.reasonCount, 1)
})

test('rejects inconsistent or unsafe scenario outcomes', () => {
  const invalidOutcomes = [
    validOutcome({
      expected: true,
      category: 'unauthorized',
      status: 401,
    }),
    validOutcome({
      expected: false,
      category: 'server-error',
      status: 0,
      transportCompleted: false,
    }),
    validOutcome({
      phase: 'unknown',
    }),
    validOutcome({
      secretsReturned: true,
    }),
    validOutcome({
      scenarioId: 'S0',
      userSequence: 1,
    }),
    validOutcome({
      responseBytes: -1,
    }),
  ]

  for (const outcome of invalidOutcomes) {
    assert.throws(() => buildScenarioMetricRecord(outcome), /Invalid PERF-P2 metric record/)
  }
})

test('rejects incomplete metric and check adapters', () => {
  const metrics = createMetricAdapter()

  delete metrics.expectedDuration

  assert.throws(
    () =>
      recordScenarioMetrics({
        outcome: validOutcome(),
        metrics,
        checkFunction: () => true,
      }),
    /metric adapter is incomplete/,
  )

  assert.throws(
    () =>
      recordScenarioMetrics({
        outcome: validOutcome(),
        metrics: createMetricAdapter(),
        checkFunction: null,
      }),
    /check function is unavailable/,
  )
})

test('k6 runtime declares only the approved custom metrics', async () => {
  const source = await readFile(
    new URL('./k6/scenario-metrics-runtime.js', import.meta.url),
    'utf8',
  )

  for (const metricName of [
    'perf_requests_total',
    'perf_expected_responses_total',
    'perf_unexpected_responses_total',
    'perf_unexpected_response_rate',
    'perf_expected_duration_ms',
    'perf_response_bytes',
  ]) {
    assert.equal(source.includes(metricName), true)
  }

  assert.match(source, /from\s+['"]k6['"]/)
  assert.match(source, /from\s+['"]k6\/metrics['"]/)
  assert.match(source, /recordScenarioMetrics\s*\(\s*\{/)

  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /userSequence/)
  assert.doesNotMatch(source, /reasons/)
})
