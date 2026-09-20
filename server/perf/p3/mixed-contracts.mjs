import { POOL_A_ALLOCATIONS } from '../p2/baseline-config.mjs'
import { getBaselineScenario } from '../p2/baseline-contracts.mjs'
import { normalizeScenarioHttpsOrigin } from '../p2/k6/scenario-http-contracts.mjs'

export const P3_MIXED_WORKLOAD = Object.freeze({
  readScenarioId: 'S4',
  readVus: 5,
  warmupSeconds: 30,
  measuredSeconds: 120,
  writeIterations: 200,
  writeRate: 100,
  writeTimeUnit: '60s',
  writePreAllocatedVus: 5,
  writeMaxVus: 5,
  readP95ThresholdMs: 350,
  writeP95ThresholdMs: 50,
})

const UNEXPECTED_CATEGORIES = Object.freeze([
  'contract-error',
  'transport-error',
  'unauthorized',
  'unexpected-conflict',
  'rate-limited',
  'server-error',
  'unexpected-status',
])

function fail(message) {
  throw new Error(`Invalid PERF-P3 mixed run: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readDailyCharacter(metadata) {
  const dailyCharacter = metadata?.dailyCharacter

  if (
    !isObject(dailyCharacter) ||
    !Number.isInteger(dailyCharacter.id) ||
    dailyCharacter.id <= 0 ||
    typeof dailyCharacter.answer !== 'string' ||
    dailyCharacter.answer.length === 0
  ) {
    fail('daily-character metadata is unavailable')
  }

  return dailyCharacter
}

function rawMetricValues(metrics, key) {
  const metric = metrics[key]

  return isObject(metric?.values) ? metric.values : null
}

function scenarioMetricValues(metrics, name, scenarioId) {
  return rawMetricValues(metrics, `${name}{perf_phase:measured,perf_scenario:${scenarioId}}`)
}

function scenarioMetricCount(metrics, name, scenarioId) {
  const values = scenarioMetricValues(metrics, name, scenarioId)

  return Number.isFinite(values?.count) ? values.count : null
}

function buildScenarioSummary(metrics, scenarioId) {
  const duration = scenarioMetricValues(metrics, 'perf_expected_duration_ms', scenarioId)
  const bytes = scenarioMetricValues(metrics, 'perf_response_bytes', scenarioId)
  const checks = scenarioMetricValues(metrics, 'checks', scenarioId)
  const unexpectedRate = scenarioMetricValues(
    metrics,
    'perf_unexpected_response_rate',
    scenarioId,
  )
  const attempted = scenarioMetricCount(metrics, 'perf_requests_total', scenarioId)
  const expected = scenarioMetricCount(metrics, 'perf_expected_responses_total', scenarioId)
  const unexpected =
    attempted !== null && expected !== null && attempted >= expected ? attempted - expected : null

  const unexpectedByCategory = Object.fromEntries(
    UNEXPECTED_CATEGORIES.map((category) => {
      const values = rawMetricValues(
        metrics,
        `perf_unexpected_responses_total{perf_phase:measured,perf_scenario:${scenarioId},perf_category:${category}}`,
      )

      return [category, Number.isFinite(values?.count) ? values.count : 0]
    }),
  )

  return {
    scenarioId,
    duration,
    bytes,
    checks,
    unexpectedRate,
    measuredAttempted: attempted,
    measuredExpected: expected,
    measuredUnexpected: unexpected,
    unexpectedByCategory,
  }
}

function p95Exceeded(summary, thresholdMs) {
  const p95 = summary.duration?.['p(95)']

  return Number.isFinite(p95) && p95 > thresholdMs
}

function addScenarioThresholds(thresholds, scenarioId, p95ThresholdMs, expectedCount) {
  const tags = `perf_phase:measured,perf_scenario:${scenarioId}`

  thresholds[`checks{${tags}}`] = [{ threshold: 'rate>=0', abortOnFail: false }]
  thresholds[`perf_unexpected_response_rate{${tags}}`] = [
    { threshold: 'rate<0.01', abortOnFail: false },
  ]
  thresholds[`perf_expected_duration_ms{${tags}}`] = [
    { threshold: `p(95)<=${p95ThresholdMs}`, abortOnFail: false },
  ]
  thresholds[`perf_response_bytes{${tags}}`] = [{ threshold: 'p(95)>=0', abortOnFail: false }]
  thresholds[`perf_requests_total{${tags}}`] = [
    { threshold: `count>=${expectedCount}`, abortOnFail: false },
  ]
  thresholds[`perf_expected_responses_total{${tags}}`] = [
    { threshold: `count>=${expectedCount}`, abortOnFail: false },
  ]

  for (const category of UNEXPECTED_CATEGORIES) {
    thresholds[
      `perf_unexpected_responses_total{${tags},perf_category:${category}}`
    ] = [{ threshold: 'count>=0', abortOnFail: false }]
  }
}

export function readP3MixedRunConfig(environment) {
  if (!isObject(environment)) {
    fail('environment is unavailable')
  }

  let baseUrl

  try {
    baseUrl = normalizeScenarioHttpsOrigin(environment.PERF_BASE_URL)
  } catch {
    fail('base URL is invalid')
  }

  return Object.freeze({
    scenarioId: 'S7',
    baseUrl,
    ...P3_MIXED_WORKLOAD,
  })
}

export function buildP3MixedRunOptions(run) {
  if (
    run?.scenarioId !== 'S7' ||
    run.readScenarioId !== P3_MIXED_WORKLOAD.readScenarioId ||
    run.readVus !== P3_MIXED_WORKLOAD.readVus ||
    run.writeIterations !== P3_MIXED_WORKLOAD.writeIterations
  ) {
    fail('run descriptor differs from the frozen mixed workload')
  }

  const thresholds = {}

  addScenarioThresholds(thresholds, 'S4', P3_MIXED_WORKLOAD.readP95ThresholdMs, 1)
  addScenarioThresholds(
    thresholds,
    'S5',
    P3_MIXED_WORKLOAD.writeP95ThresholdMs,
    P3_MIXED_WORKLOAD.writeIterations,
  )
  thresholds['dropped_iterations{scenario:p3_mixed_write}'] = [
    { threshold: 'count==0', abortOnFail: false },
  ]

  return {
    scenarios: {
      p3_mixed_read: {
        executor: 'constant-vus',
        exec: 'runP3MixedReadScenario',
        vus: P3_MIXED_WORKLOAD.readVus,
        duration: `${P3_MIXED_WORKLOAD.warmupSeconds + P3_MIXED_WORKLOAD.measuredSeconds}s`,
        gracefulStop: '30s',
      },
      p3_mixed_write: {
        executor: 'constant-arrival-rate',
        exec: 'runP3MixedWriteScenario',
        rate: P3_MIXED_WORKLOAD.writeRate,
        timeUnit: P3_MIXED_WORKLOAD.writeTimeUnit,
        duration: `${P3_MIXED_WORKLOAD.measuredSeconds}s`,
        startTime: `${P3_MIXED_WORKLOAD.warmupSeconds}s`,
        preAllocatedVUs: P3_MIXED_WORKLOAD.writePreAllocatedVus,
        maxVUs: P3_MIXED_WORKLOAD.writeMaxVus,
        gracefulStop: '30s',
      },
    },
    thresholds,
    summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(95)', 'max'],
    systemTags: [
      'status',
      'method',
      'name',
      'scenario',
      'expected_response',
      'error',
      'error_code',
    ],
  }
}

export function resolveP3MixedReadPhase(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    fail('elapsed time is invalid')
  }

  const warmupMilliseconds = P3_MIXED_WORKLOAD.warmupSeconds * 1000
  const totalMilliseconds =
    (P3_MIXED_WORKLOAD.warmupSeconds + P3_MIXED_WORKLOAD.measuredSeconds) * 1000

  if (elapsedMs >= totalMilliseconds) return null

  return elapsedMs < warmupMilliseconds ? 'warmup' : 'measured'
}

export function selectP3MixedWriteSequence(iteration) {
  const range = POOL_A_ALLOCATIONS.baselineMixed

  if (!Number.isInteger(iteration) || iteration < 0 || iteration >= range.users) {
    fail('write iteration is outside the baseline mixed allocation')
  }

  return range.firstSeq + iteration
}

export function buildP3MixedWriteRequestPlan({ sequence, metadata }) {
  const scenario = getBaselineScenario('S5')
  const range = POOL_A_ALLOCATIONS.baselineMixed
  const dailyCharacter = readDailyCharacter(metadata)

  if (!Number.isInteger(sequence) || sequence < range.firstSeq || sequence > range.lastSeq) {
    fail('user sequence is outside the baseline mixed allocation')
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    method: scenario.method,
    path: scenario.path,
    pool: scenario.pool,
    userSequence: sequence,
    authentication: scenario.authentication,
    workload: scenario.workload,
    body: {
      characterId: dailyCharacter.id,
      answer: dailyCharacter.answer,
    },
    expectation: {
      status: scenario.expectedStatus,
      code: scenario.expectedCode ?? null,
      responseContract: scenario.responseContract,
      expectedTodayAnswer: null,
      expectedCharacterId: dailyCharacter.id,
    },
  }
}

export function buildP3MixedSummary(run, data) {
  if (!isObject(data?.metrics)) {
    fail('k6 summary metrics are unavailable')
  }

  const read = buildScenarioSummary(data.metrics, 'S4')
  const write = buildScenarioSummary(data.metrics, 'S5')
  const droppedWriteIterations = rawMetricValues(
    data.metrics,
    'dropped_iterations{scenario:p3_mixed_write}',
  )?.count ?? 0

  return {
    label: 'p3-S7-mixed-baseline',
    phase: 'P3',
    runKind: 'mixed',
    scenario: 'S7',
    mixedLoad: {
      readScenarioId: run.readScenarioId,
      readVus: run.readVus,
      writeIterations: run.writeIterations,
      writeRate: run.writeRate,
      writeTimeUnit: run.writeTimeUnit,
      writePreAllocatedVus: run.writePreAllocatedVus,
      writeMaxVus: run.writeMaxVus,
      readP95ThresholdMs: run.readP95ThresholdMs,
      writeP95ThresholdMs: run.writeP95ThresholdMs,
    },
    read,
    write,
    readP95ThresholdExceeded: p95Exceeded(read, run.readP95ThresholdMs),
    writeP95ThresholdExceeded: p95Exceeded(write, run.writeP95ThresholdMs),
    droppedWriteIterations,
    successfulWriteUsers: write.measuredExpected,
    mixedRunFailed:
      read.measuredUnexpected !== 0 ||
      write.measuredUnexpected !== 0 ||
      write.measuredExpected !== P3_MIXED_WORKLOAD.writeIterations ||
      droppedWriteIterations !== 0,
  }
}
