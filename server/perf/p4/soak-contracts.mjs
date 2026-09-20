import { getBaselineScenario } from '../p2/baseline-contracts.mjs'
import { normalizeScenarioHttpsOrigin } from '../p2/k6/scenario-http-contracts.mjs'

export const P4_SOAK_WORKLOAD = Object.freeze({
  scenarioId: 'S4',
  vus: 5,
  warmupSeconds: 30,
  windowSeconds: 600,
  windows: Object.freeze(['opening', 'middle', 'closing']),
  measuredSeconds: 1800,
  p95ThresholdMs: 350,
  maximumP95GrowthRatio: 1.25,
  minimumThroughputRetentionRatio: 0.8,
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
  throw new Error(`Invalid PERF-P4 soak run: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rawMetricValues(metrics, key) {
  const metric = metrics[key]
  return isObject(metric?.values) ? metric.values : null
}

function metricValues(metrics, name, selector = 'perf_phase:measured') {
  return rawMetricValues(metrics, `${name}{${selector}}`)
}

function metricCount(metrics, name, selector) {
  const values = metricValues(metrics, name, selector)
  return Number.isFinite(values?.count) ? values.count : null
}

function addMeasuredThresholds(thresholds, selector) {
  thresholds[`checks{${selector}}`] = [{ threshold: 'rate>=0', abortOnFail: false }]
  thresholds[`perf_unexpected_response_rate{${selector}}`] = [
    { threshold: 'rate<0.01', abortOnFail: false },
  ]
  thresholds[`perf_expected_duration_ms{${selector}}`] = [
    { threshold: `p(95)<=${P4_SOAK_WORKLOAD.p95ThresholdMs}`, abortOnFail: false },
  ]
  thresholds[`perf_response_bytes{${selector}}`] = [{ threshold: 'p(95)>=0', abortOnFail: false }]
  thresholds[`perf_requests_total{${selector}}`] = [{ threshold: 'count>0', abortOnFail: false }]
  thresholds[`perf_expected_responses_total{${selector}}`] = [
    { threshold: 'count>0', abortOnFail: false },
  ]
}

function buildWindowSummary(metrics, window) {
  const scenarioName = `p4_soak_${window}`
  const selector = `perf_phase:measured,scenario:${scenarioName}`
  const attempted = metricCount(metrics, 'perf_requests_total', selector)
  const expected = metricCount(metrics, 'perf_expected_responses_total', selector)

  return {
    window,
    scenarioName,
    duration: metricValues(metrics, 'perf_expected_duration_ms', selector),
    unexpectedRate: metricValues(metrics, 'perf_unexpected_response_rate', selector),
    measuredAttempted: attempted,
    measuredExpected: expected,
    measuredUnexpected:
      attempted !== null && expected !== null && attempted >= expected
        ? attempted - expected
        : null,
    completedExpectedPerSecond:
      expected === null ? null : expected / P4_SOAK_WORKLOAD.windowSeconds,
  }
}

export function readP4SoakConfig(environment) {
  if (!isObject(environment)) fail('environment is unavailable')

  let baseUrl

  try {
    baseUrl = normalizeScenarioHttpsOrigin(environment.PERF_BASE_URL)
  } catch {
    fail('base URL is invalid')
  }

  return Object.freeze({
    ...P4_SOAK_WORKLOAD,
    baseUrl,
  })
}

export function buildP4SoakOptions(run) {
  const scenario = getBaselineScenario(run?.scenarioId)

  if (
    scenario.id !== P4_SOAK_WORKLOAD.scenarioId ||
    run.vus !== P4_SOAK_WORKLOAD.vus ||
    run.measuredSeconds !== P4_SOAK_WORKLOAD.measuredSeconds ||
    run.p95ThresholdMs !== P4_SOAK_WORKLOAD.p95ThresholdMs
  ) {
    fail('run descriptor differs from the frozen soak workload')
  }

  const scenarios = {
    p4_soak_warmup: {
      executor: 'constant-vus',
      exec: 'runP4SoakWarmup',
      vus: run.vus,
      duration: `${run.warmupSeconds}s`,
      gracefulStop: '30s',
    },
  }

  const thresholds = {}
  addMeasuredThresholds(thresholds, 'perf_phase:measured')

  run.windows.forEach((window, index) => {
    const scenarioName = `p4_soak_${window}`
    scenarios[scenarioName] = {
      executor: 'constant-vus',
      exec: `runP4Soak${window[0].toUpperCase()}${window.slice(1)}`,
      vus: run.vus,
      startTime: `${run.warmupSeconds + index * run.windowSeconds}s`,
      duration: `${run.windowSeconds}s`,
      gracefulStop: '30s',
    }

    addMeasuredThresholds(thresholds, `perf_phase:measured,scenario:${scenarioName}`)
  })

  for (const category of UNEXPECTED_CATEGORIES) {
    thresholds[`perf_unexpected_responses_total{perf_phase:measured,perf_category:${category}}`] = [
      { threshold: 'count>=0', abortOnFail: false },
    ]
  }

  return {
    scenarios,
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

export function buildP4SoakSummary(run, data) {
  if (!isObject(data?.metrics)) fail('k6 summary metrics are unavailable')

  const windows = run.windows.map((window) => buildWindowSummary(data.metrics, window))
  const opening = windows[0]
  const closing = windows.at(-1)
  const openingP95 = opening.duration?.['p(95)']
  const closingP95 = closing.duration?.['p(95)']
  const p95GrowthRatio =
    Number.isFinite(openingP95) && openingP95 > 0 && Number.isFinite(closingP95)
      ? closingP95 / openingP95
      : null
  const throughputRetentionRatio =
    Number.isFinite(opening.completedExpectedPerSecond) &&
    opening.completedExpectedPerSecond > 0 &&
    Number.isFinite(closing.completedExpectedPerSecond)
      ? closing.completedExpectedPerSecond / opening.completedExpectedPerSecond
      : null
  const attempted = metricCount(data.metrics, 'perf_requests_total', 'perf_phase:measured')
  const expected = metricCount(data.metrics, 'perf_expected_responses_total', 'perf_phase:measured')
  const overallUnexpectedRate = metricValues(data.metrics, 'perf_unexpected_response_rate')

  const unexpectedByCategory = Object.fromEntries(
    UNEXPECTED_CATEGORIES.map((category) => {
      const values = rawMetricValues(
        data.metrics,
        `perf_unexpected_responses_total{perf_phase:measured,perf_category:${category}}`,
      )
      return [category, Number.isFinite(values?.count) ? values.count : 0]
    }),
  )

  const stabilityFailed =
    attempted === null ||
    expected === null ||
    !Number.isFinite(overallUnexpectedRate?.rate) ||
    overallUnexpectedRate.rate >= 0.01 ||
    windows.some(
      (window) =>
        !Number.isFinite(window.unexpectedRate?.rate) ||
        window.unexpectedRate.rate >= 0.01 ||
        !Number.isFinite(window.duration?.['p(95)']) ||
        window.duration['p(95)'] > run.p95ThresholdMs,
    ) ||
    !Number.isFinite(p95GrowthRatio) ||
    p95GrowthRatio > run.maximumP95GrowthRatio ||
    !Number.isFinite(throughputRetentionRatio) ||
    throughputRetentionRatio < run.minimumThroughputRetentionRatio

  return {
    label: 'p4-S4-vu5-soak',
    phase: 'P4',
    runKind: 'soak',
    scenario: run.scenarioId,
    vus: run.vus,
    warmupSeconds: run.warmupSeconds,
    measuredSeconds: run.measuredSeconds,
    p95ThresholdMs: run.p95ThresholdMs,
    maximumP95GrowthRatio: run.maximumP95GrowthRatio,
    minimumThroughputRetentionRatio: run.minimumThroughputRetentionRatio,
    overall: {
      duration: metricValues(data.metrics, 'perf_expected_duration_ms'),
      checks: metricValues(data.metrics, 'checks'),
      unexpectedRate: overallUnexpectedRate,
      measuredAttempted: attempted,
      measuredExpected: expected,
      measuredUnexpected:
        attempted !== null && expected !== null && attempted >= expected
          ? attempted - expected
          : null,
      unexpectedByCategory,
    },
    windows,
    p95GrowthRatio,
    p95GrowthPercent: p95GrowthRatio === null ? null : (p95GrowthRatio - 1) * 100,
    throughputRetentionRatio,
    throughputChangePercent:
      throughputRetentionRatio === null ? null : (throughputRetentionRatio - 1) * 100,
    stabilityFailed,
  }
}
