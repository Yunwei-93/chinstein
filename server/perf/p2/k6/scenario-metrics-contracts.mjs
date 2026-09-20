import { POOLS } from '../../fixture-config.mjs'

import { getBaselineScenario } from '../baseline-contracts.mjs'

const APPROVED_PHASES = new Set(['warmup', 'measured'])

const APPROVED_CATEGORIES = new Set([
  'expected',
  'contract-error',
  'transport-error',
  'unauthorized',
  'unexpected-conflict',
  'rate-limited',
  'server-error',
  'unexpected-status',
])

const REQUIRED_METRICS = [
  'attempted',
  'expected',
  'unexpected',
  'unexpectedRate',
  'expectedDuration',
  'responseBytes',
]

function fail(message) {
  throw new Error(`Invalid PERF-P2 metric record: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateOutcome(outcome) {
  if (!isObject(outcome)) {
    fail('scenario outcome is unavailable')
  }

  let scenario

  try {
    scenario = getBaselineScenario(outcome.scenarioId)
  } catch {
    fail('scenario is not approved')
  }

  if (!APPROVED_PHASES.has(outcome.phase)) {
    fail('phase is not approved')
  }

  if (typeof outcome.expected !== 'boolean') {
    fail('expected-result flag is invalid')
  }

  if (!APPROVED_CATEGORIES.has(outcome.category)) {
    fail('response category is not approved')
  }

  if (
    !Number.isInteger(outcome.status) ||
    (outcome.status !== 0 && (outcome.status < 100 || outcome.status > 599))
  ) {
    fail('response status is invalid')
  }

  if (
    !Array.isArray(outcome.reasons) ||
    outcome.reasons.some((reason) => typeof reason !== 'string')
  ) {
    fail('response reasons are invalid')
  }

  if (
    outcome.durationMs !== null &&
    (!Number.isFinite(outcome.durationMs) || outcome.durationMs < 0)
  ) {
    fail('response duration is invalid')
  }

  if (!Number.isInteger(outcome.responseBytes) || outcome.responseBytes < 0) {
    fail('response byte count is invalid')
  }

  if (outcome.requestAttempted !== true || outcome.secretsReturned !== false) {
    fail('outcome safety flags are invalid')
  }

  if (outcome.transportCompleted !== (outcome.status !== 0)) {
    fail('transport state does not match response status')
  }

  if (outcome.expected !== (outcome.category === 'expected')) {
    fail('expected flag does not match response category')
  }

  if (
    outcome.expected &&
    (outcome.status !== scenario.expectedStatus || outcome.durationMs === null)
  ) {
    fail('expected response does not match the scenario contract')
  }

  if (outcome.status === 0 && outcome.category !== 'transport-error') {
    fail('missing response status is not a transport error')
  }

  if (outcome.status !== 0 && outcome.category === 'transport-error') {
    fail('transport error unexpectedly has an HTTP status')
  }

  if (scenario.pool === null) {
    if (outcome.userSequence !== null) {
      fail('unauthenticated scenario unexpectedly identifies a user')
    }
  } else {
    const pool = POOLS[scenario.pool]

    if (
      !pool ||
      !Number.isInteger(outcome.userSequence) ||
      outcome.userSequence < pool.firstSeq ||
      outcome.userSequence > pool.lastSeq
    ) {
      fail('scenario user is outside the approved pool')
    }
  }

  return scenario
}

function validateMetricAdapter(metrics, checkFunction) {
  if (!isObject(metrics)) {
    fail('metric adapter is unavailable')
  }

  for (const name of REQUIRED_METRICS) {
    if (typeof metrics[name]?.add !== 'function') {
      fail('metric adapter is incomplete')
    }
  }

  if (typeof checkFunction !== 'function') {
    fail('check function is unavailable')
  }
}

export function buildScenarioMetricRecord(outcome) {
  const scenario = validateOutcome(outcome)

  const tags = {
    perf_scenario: scenario.id,
    perf_phase: outcome.phase,
    perf_category: outcome.category,
    perf_pool: scenario.pool ?? 'none',
    expected_status: String(scenario.expectedStatus),
    actual_status: String(outcome.status),
  }

  return {
    expected: outcome.expected,
    durationMs: outcome.expected ? outcome.durationMs : null,
    responseBytes: outcome.responseBytes,
    tags,
    summary: {
      scenarioId: scenario.id,
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
    },
  }
}

export function recordScenarioMetrics({ outcome, metrics, checkFunction }) {
  validateMetricAdapter(metrics, checkFunction)

  const record = buildScenarioMetricRecord(outcome)

  let checkPassed

  try {
    metrics.attempted.add(1, record.tags)
    metrics.unexpectedRate.add(!record.expected, record.tags)
    metrics.responseBytes.add(record.responseBytes, record.tags)

    if (record.expected) {
      metrics.expected.add(1, record.tags)
      metrics.expectedDuration.add(record.durationMs, record.tags)
    } else {
      metrics.unexpected.add(1, record.tags)
    }

    checkPassed = checkFunction(
      record,
      {
        'PERF response matched expected contract': (value) => value.expected === true,
      },
      record.tags,
    )
  } catch {
    fail('metric recording failed')
  }

  if (typeof checkPassed !== 'boolean') {
    fail('check function returned an invalid result')
  }

  return {
    ...record.summary,
    checkPassed,
  }
}
