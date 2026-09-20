import { POOL_A_ALLOCATIONS } from '../p2/baseline-config.mjs'
import { getBaselineScenario } from '../p2/baseline-contracts.mjs'
import { normalizeScenarioHttpsOrigin } from '../p2/k6/scenario-http-contracts.mjs'

export const P3_WRITE_LEVELS = Object.freeze([5, 10, 20, 40, 80])
export const P3_WRITE_REPETITIONS = 3
export const P3_WRITE_ITERATIONS = 200
export const P3_WRITE_P95_THRESHOLD_MS = 50

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
  throw new Error(`Invalid PERF-P3 write run: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readCanonicalInteger(value, approvedValues, name) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    fail(`${name} must be a canonical positive integer`)
  }

  const parsed = Number(value)

  if (!approvedValues.includes(parsed)) {
    fail(`${name} is outside the approved values`)
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

export function selectP3WriteSequence({ vus, repetition, iteration }) {
  const levelIndex = P3_WRITE_LEVELS.indexOf(vus)

  if (levelIndex === -1) {
    fail('VU level is outside the write ladder')
  }

  if (!Number.isInteger(repetition) || repetition < 1 || repetition > P3_WRITE_REPETITIONS) {
    fail('repetition is outside the write ladder')
  }

  if (!Number.isInteger(iteration) || iteration < 0 || iteration >= P3_WRITE_ITERATIONS) {
    fail('iteration is outside the write batch')
  }

  const roundIndex = (repetition - 1) * P3_WRITE_LEVELS.length + levelIndex

  return POOL_A_ALLOCATIONS.baselineIsolated.firstSeq + roundIndex * P3_WRITE_ITERATIONS + iteration
}

export function readP3WriteRunConfig(environment) {
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
    scenarioId: 'S5',
    vus: readCanonicalInteger(environment.PERF_P3_VUS, P3_WRITE_LEVELS, 'VU level'),
    repetition: readCanonicalInteger(
      environment.PERF_P3_REPETITION,
      Array.from({ length: P3_WRITE_REPETITIONS }, (_, index) => index + 1),
      'repetition',
    ),
    baseUrl,
    p95ThresholdMs: P3_WRITE_P95_THRESHOLD_MS,
  })
}

export function buildP3WriteRunOptions(run) {
  if (
    run?.scenarioId !== 'S5' ||
    !P3_WRITE_LEVELS.includes(run.vus) ||
    !Number.isInteger(run.repetition) ||
    run.repetition < 1 ||
    run.repetition > P3_WRITE_REPETITIONS ||
    run.p95ThresholdMs !== P3_WRITE_P95_THRESHOLD_MS
  ) {
    fail('run descriptor differs from the frozen write ladder')
  }

  const thresholds = {
    'checks{perf_phase:measured}': [{ threshold: 'rate>=0', abortOnFail: false }],
    'perf_unexpected_response_rate{perf_phase:measured}': [
      { threshold: 'rate<0.01', abortOnFail: false },
    ],
    'perf_expected_duration_ms{perf_phase:measured}': [
      { threshold: `p(95)<=${P3_WRITE_P95_THRESHOLD_MS}`, abortOnFail: false },
    ],
    'perf_response_bytes{perf_phase:measured}': [{ threshold: 'p(95)>=0', abortOnFail: false }],
    'perf_requests_total{perf_phase:measured}': [
      { threshold: `count>=${P3_WRITE_ITERATIONS}`, abortOnFail: false },
    ],
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
      p3_write: {
        executor: 'shared-iterations',
        exec: 'runP3WriteScenario',
        vus: run.vus,
        iterations: P3_WRITE_ITERATIONS,
        maxDuration: '10m',
        gracefulStop: '30s',
        tags: {
          perf_run_phase: 'P3',
          perf_run_kind: 'write',
          perf_run_scenario: 'S5',
          perf_run_vus: String(run.vus),
          perf_run_repetition: String(run.repetition),
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

export function buildP3WriteRequestPlan({ sequence, metadata }) {
  const scenario = getBaselineScenario('S5')
  const range = POOL_A_ALLOCATIONS.baselineIsolated
  const dailyCharacter = readDailyCharacter(metadata)

  if (!Number.isInteger(sequence) || sequence < range.firstSeq || sequence > range.lastSeq) {
    fail('user sequence is outside the baseline isolated allocation')
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

export function buildP3WriteSummary(run, data) {
  if (!isObject(data?.metrics)) {
    fail('k6 summary metrics are unavailable')
  }

  const duration = metricValues(data.metrics, 'perf_expected_duration_ms')
  const bytes = metricValues(data.metrics, 'perf_response_bytes')
  const checks = metricValues(data.metrics, 'checks')
  const unexpectedRate = metricValues(data.metrics, 'perf_unexpected_response_rate')
  const attempted = metricCount(data.metrics, 'perf_requests_total')
  const expected = metricCount(data.metrics, 'perf_expected_responses_total')
  const completionTimeMs = Number.isFinite(data.state?.testRunDurationMs)
    ? data.state.testRunDurationMs
    : null

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
    label: `p3-S5-vu${run.vus}-rep${run.repetition}`,
    phase: 'P3',
    runKind: 'write',
    scenario: 'S5',
    vus: run.vus,
    repetition: run.repetition,
    iterationsPlanned: P3_WRITE_ITERATIONS,
    p95ThresholdMs: P3_WRITE_P95_THRESHOLD_MS,
    duration,
    bytes,
    checks,
    unexpectedRate,
    measuredAttempted: attempted,
    measuredExpected: expected,
    measuredUnexpected: unexpected,
    unexpectedByCategory,
    completionTimeMs,
    finiteBatchCompletionRate: expected === null ? null : expected / P3_WRITE_ITERATIONS,
    p95ThresholdExceeded:
      Number.isFinite(duration?.['p(95)']) && duration['p(95)'] > P3_WRITE_P95_THRESHOLD_MS,
    errorBudgetExceeded: Number.isFinite(unexpectedRate?.rate) && unexpectedRate.rate >= 0.01,
  }
}
