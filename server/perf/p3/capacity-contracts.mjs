import { getBaselineScenario } from '../p2/baseline-contracts.mjs'
import { normalizeScenarioHttpsOrigin } from '../p2/k6/scenario-http-contracts.mjs'

export const P3_TIMED_WORKLOAD = Object.freeze({
  warmupSeconds: 30,
  measuredSeconds: 120,
})

export const P3_CAPACITY_LEVELS = Object.freeze({
  S0: Object.freeze([1, 2, 5, 10, 20, 40, 80]),
  S1: Object.freeze([1, 2, 5, 8]),
  S2: Object.freeze([5, 10, 20, 40, 80]),
  S3: Object.freeze([5, 10, 20, 40, 80]),
  S4: Object.freeze([1, 2, 5, 10, 20, 40, 80]),
  S6: Object.freeze([5, 10, 20, 40, 80]),
})

export const P3_P95_THRESHOLDS_MS = Object.freeze({
  S0: 50,
  S1: 550,
  S2: 100,
  S3: 50,
  S4: 350,
  S6: 150,
})

const RUN_KINDS = new Set(['initial', 'confirmation'])

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
  throw new Error(`Invalid PERF-P3 capacity run: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readScenario(scenarioId) {
  const levels = P3_CAPACITY_LEVELS[scenarioId]

  if (!levels) {
    fail('scenario is not approved for the timed capacity ladder')
  }

  const scenario = getBaselineScenario(scenarioId)

  if (scenario.workload !== 'timed') {
    fail('scenario is not a timed workload')
  }

  return scenario
}

function readCanonicalLevel(value, approvedLevels) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    fail('VU level must be a canonical positive integer')
  }

  const parsed = Number(value)

  if (!approvedLevels.includes(parsed)) {
    fail('VU level is outside the scenario ladder')
  }

  return parsed
}

function rawMetricValues(metrics, key) {
  const metric = metrics[key]

  return isObject(metric?.values) ? metric.values : null
}

function metricValues(metrics, name) {
  return rawMetricValues(metrics, `${name}{perf_phase:measured}`)
}

function metricCount(metrics, name) {
  const values = metricValues(metrics, name)

  return Number.isFinite(values?.count) ? values.count : null
}

export function getP3CapacityLevels(scenarioId) {
  readScenario(scenarioId)
  return [...P3_CAPACITY_LEVELS[scenarioId]]
}

export function readP3CapacityRunConfig(environment) {
  if (!isObject(environment)) {
    fail('environment is unavailable')
  }

  const scenario = readScenario(environment.PERF_P3_SCENARIO_ID)
  const levels = P3_CAPACITY_LEVELS[scenario.id]
  const runKind = environment.PERF_P3_RUN_KIND

  if (!RUN_KINDS.has(runKind)) {
    fail('run kind must be initial or confirmation')
  }

  let baseUrl

  try {
    baseUrl = normalizeScenarioHttpsOrigin(environment.PERF_BASE_URL)
  } catch {
    fail('base URL is invalid')
  }

  return Object.freeze({
    scenarioId: scenario.id,
    vus: readCanonicalLevel(environment.PERF_P3_VUS, levels),
    runKind,
    baseUrl,
    p95ThresholdMs: P3_P95_THRESHOLDS_MS[scenario.id],
  })
}

export function buildP3CapacityRunOptions(run) {
  const scenario = readScenario(run?.scenarioId)

  if (!P3_CAPACITY_LEVELS[scenario.id].includes(run.vus)) {
    fail('VU level is outside the scenario ladder')
  }

  if (!RUN_KINDS.has(run.runKind)) {
    fail('run kind is invalid')
  }

  if (run.p95ThresholdMs !== P3_P95_THRESHOLDS_MS[scenario.id]) {
    fail('p95 threshold differs from the frozen P2 threshold')
  }

  const thresholds = {
    'checks{perf_phase:measured}': [{ threshold: 'rate>=0', abortOnFail: false }],
    'perf_unexpected_response_rate{perf_phase:measured}': [
      { threshold: 'rate<0.01', abortOnFail: false },
    ],
    'perf_expected_duration_ms{perf_phase:measured}': [
      { threshold: `p(95)<=${run.p95ThresholdMs}`, abortOnFail: false },
    ],
    'perf_response_bytes{perf_phase:measured}': [{ threshold: 'p(95)>=0', abortOnFail: false }],
    'perf_requests_total{perf_phase:measured}': [{ threshold: 'count>=0', abortOnFail: false }],
    'perf_expected_responses_total{perf_phase:measured}': [
      { threshold: 'count>=0', abortOnFail: false },
    ],
  }

  for (const category of UNEXPECTED_CATEGORIES) {
    thresholds[`perf_unexpected_responses_total{perf_phase:measured,perf_category:${category}}`] = [
      { threshold: 'count>=0', abortOnFail: false },
    ]
  }

  return {
    scenarios: {
      p3_capacity: {
        executor: 'constant-vus',
        exec: 'runP3CapacityScenario',
        vus: run.vus,
        duration: `${P3_TIMED_WORKLOAD.warmupSeconds + P3_TIMED_WORKLOAD.measuredSeconds}s`,
        gracefulStop: '30s',
        tags: {
          perf_run_phase: 'P3',
          perf_run_kind: run.runKind,
          perf_run_scenario: scenario.id,
          perf_run_vus: String(run.vus),
        },
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

export function resolveP3CapacityPhase(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    fail('elapsed time is invalid')
  }

  const warmupMilliseconds = P3_TIMED_WORKLOAD.warmupSeconds * 1000
  const totalMilliseconds =
    (P3_TIMED_WORKLOAD.warmupSeconds + P3_TIMED_WORKLOAD.measuredSeconds) * 1000

  if (elapsedMs >= totalMilliseconds) {
    return null
  }

  return elapsedMs < warmupMilliseconds ? 'warmup' : 'measured'
}

export function buildP3CapacitySummary(run, data) {
  if (!isObject(data?.metrics)) {
    fail('k6 summary metrics are unavailable')
  }

  const duration = metricValues(data.metrics, 'perf_expected_duration_ms')
  const bytes = metricValues(data.metrics, 'perf_response_bytes')
  const unexpectedRate = metricValues(data.metrics, 'perf_unexpected_response_rate')
  const checks = metricValues(data.metrics, 'checks')
  const attempted = metricCount(data.metrics, 'perf_requests_total')
  const expected = metricCount(data.metrics, 'perf_expected_responses_total')

  const unexpected =
    attempted !== null && expected !== null && attempted >= expected ? attempted - expected : null

  const unexpectedByCategory = Object.fromEntries(
    UNEXPECTED_CATEGORIES.map((category) => {
      const values = rawMetricValues(
        data.metrics,
        `perf_unexpected_responses_total{perf_phase:measured,perf_category:${category}}`,
      )

      return [category, Number.isFinite(values?.count) ? values.count : 0]
    }),
  )

  return {
    label: `p3-${run.scenarioId}-vu${run.vus}-${run.runKind}`,
    phase: 'P3',
    runKind: run.runKind,
    scenario: run.scenarioId,
    vus: run.vus,
    measuredSeconds: P3_TIMED_WORKLOAD.measuredSeconds,
    p95ThresholdMs: run.p95ThresholdMs,
    duration,
    bytes,
    checks,
    unexpectedRate,
    measuredAttempted: attempted,
    measuredExpected: expected,
    measuredUnexpected: unexpected,
    unexpectedByCategory,
    completedExpectedPerSecond:
      expected === null ? null : expected / P3_TIMED_WORKLOAD.measuredSeconds,
    p95ThresholdExceeded:
      Number.isFinite(duration?.['p(95)']) && duration['p(95)'] > run.p95ThresholdMs,
    errorBudgetExceeded: Number.isFinite(unexpectedRate?.rate) && unexpectedRate.rate >= 0.01,
  }
}
