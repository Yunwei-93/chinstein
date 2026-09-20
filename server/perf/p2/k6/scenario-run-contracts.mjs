import {
  P2_LEVELS,
  P2_REPETITIONS,
  P2_TIMED_WORKLOAD,
  P2_WRITE_WORKLOAD,
} from '../baseline-config.mjs'
import { getBaselineScenario } from '../baseline-contracts.mjs'

import { normalizeScenarioHttpsOrigin } from './scenario-http-contracts.mjs'
import { buildScenarioRequestPlan, selectP2WriteSequence } from './scenario-request-plan.mjs'

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

const RUN_KEYS = ['baseUrl', 'repetition', 'scenarioId', 'vus', 'workload']

const SUMMARY_KEYS = [
  'category',
  'checkPassed',
  'durationRecorded',
  'expected',
  'phase',
  'reasonCount',
  'requestAttempted',
  'responseBytes',
  'scenarioId',
  'secretsReturned',
  'status',
  'transportCompleted',
]

const REQUIRED_DEPENDENCIES = [
  'executeScenarioHttpRequest',
  'getFixtureMetadata',
  'getTokenUserBySequence',
  'readLoginPassword',
  'recordScenarioMetrics',
]

function fail(message) {
  throw new Error(`Invalid PERF-P2 scenario run: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) {
    return false
  }

  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()

  return JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys)
}

function readApprovedScenario(scenarioId) {
  if (typeof scenarioId !== 'string' || !/^S[0-6]$/.test(scenarioId)) {
    fail('scenario ID is invalid')
  }

  try {
    return getBaselineScenario(scenarioId)
  } catch {
    fail('scenario is not approved')
  }
}

function readCanonicalInteger(value, allowedValues, name) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    fail(`${name} must be a canonical positive integer`)
  }

  const parsed = Number(value)

  if (!allowedValues.includes(parsed)) {
    fail(`${name} is outside the approved values`)
  }

  return parsed
}

function readSafeOrigin(value) {
  try {
    return normalizeScenarioHttpsOrigin(value)
  } catch {
    fail('base URL is invalid')
  }
}

function validateRunDescriptor(run) {
  if (!hasExactKeys(run, RUN_KEYS)) {
    fail('run descriptor has an invalid shape')
  }

  const scenario = readApprovedScenario(run.scenarioId)

  if (!P2_LEVELS.includes(run.vus) || !Number.isInteger(run.vus)) {
    fail('VU level is not approved')
  }

  if (!Number.isInteger(run.repetition) || run.repetition < 1 || run.repetition > P2_REPETITIONS) {
    fail('repetition is not approved')
  }

  if (run.workload !== scenario.workload) {
    fail('workload differs from the frozen scenario')
  }

  const normalizedOrigin = readSafeOrigin(run.baseUrl)

  if (normalizedOrigin !== run.baseUrl) {
    fail('base URL is not normalized')
  }

  return scenario
}

function validateDependencies(dependencies) {
  if (!isObject(dependencies)) {
    fail('runtime dependencies are unavailable')
  }

  for (const name of REQUIRED_DEPENDENCIES) {
    if (typeof dependencies[name] !== 'function') {
      fail(`runtime dependency ${name} is unavailable`)
    }
  }
}

function callStage(stage, operation) {
  try {
    return operation()
  } catch {
    fail(`${stage} failed`)
  }
}

function validateMetricSummary(summary, scenario, phase) {
  if (!hasExactKeys(summary, SUMMARY_KEYS)) {
    fail('metric summary has an invalid shape')
  }

  if (summary.scenarioId !== scenario.id || summary.phase !== phase) {
    fail('metric summary identifies the wrong run')
  }

  if (
    typeof summary.expected !== 'boolean' ||
    !APPROVED_CATEGORIES.has(summary.category) ||
    summary.expected !== (summary.category === 'expected')
  ) {
    fail('metric summary has an invalid classification')
  }

  if (
    !Number.isInteger(summary.status) ||
    (summary.status !== 0 && (summary.status < 100 || summary.status > 599))
  ) {
    fail('metric summary has an invalid status')
  }

  if (summary.expected && summary.status !== scenario.expectedStatus) {
    fail('expected metric summary has the wrong status')
  }

  if (
    typeof summary.durationRecorded !== 'boolean' ||
    summary.durationRecorded !== summary.expected
  ) {
    fail('metric summary has an invalid duration state')
  }

  if (!Number.isInteger(summary.responseBytes) || summary.responseBytes < 0) {
    fail('metric summary has an invalid byte count')
  }

  if (
    summary.requestAttempted !== true ||
    typeof summary.transportCompleted !== 'boolean' ||
    summary.transportCompleted !== (summary.status !== 0)
  ) {
    fail('metric summary has an invalid transport state')
  }

  if (!Number.isInteger(summary.reasonCount) || summary.reasonCount < 0) {
    fail('metric summary has an invalid reason count')
  }

  if (
    summary.secretsReturned !== false ||
    typeof summary.checkPassed !== 'boolean' ||
    summary.checkPassed !== summary.expected
  ) {
    fail('metric summary has an invalid safety result')
  }

  return Object.freeze({
    scenarioId: summary.scenarioId,
    phase: summary.phase,
    expected: summary.expected,
    category: summary.category,
    status: summary.status,
    durationRecorded: summary.durationRecorded,
    responseBytes: summary.responseBytes,
    requestAttempted: summary.requestAttempted,
    transportCompleted: summary.transportCompleted,
    reasonCount: summary.reasonCount,
    secretsReturned: false,
    checkPassed: summary.checkPassed,
  })
}

export function readScenarioRunConfig(environment) {
  if (!isObject(environment)) {
    fail('environment is unavailable')
  }

  const scenario = readApprovedScenario(environment.PERF_P2_SCENARIO_ID)

  const vus = readCanonicalInteger(environment.PERF_P2_VUS, P2_LEVELS, 'VU level')

  const repetition = readCanonicalInteger(
    environment.PERF_P2_REPETITION,
    Array.from({ length: P2_REPETITIONS }, (_, index) => index + 1),
    'repetition',
  )

  return Object.freeze({
    scenarioId: scenario.id,
    workload: scenario.workload,
    vus,
    repetition,
    baseUrl: readSafeOrigin(environment.PERF_BASE_URL),
  })
}

export function buildScenarioRunOptions(run) {
  const scenario = validateRunDescriptor(run)

  const scenarioTags = {
    perf_run_scenario: scenario.id,
    perf_run_vus: String(run.vus),
    perf_run_repetition: String(run.repetition),
  }

  const execution =
    scenario.workload === 'finite-write'
      ? {
          executor: 'shared-iterations',
          exec: 'runP2Scenario',
          vus: run.vus,
          iterations: P2_WRITE_WORKLOAD.warmupIterations + P2_WRITE_WORKLOAD.measuredIterations,
          maxDuration: '10m',
          gracefulStop: '30s',
          tags: scenarioTags,
        }
      : {
          executor: 'constant-vus',
          exec: 'runP2Scenario',
          vus: run.vus,
          duration: `${P2_TIMED_WORKLOAD.warmupSeconds + P2_TIMED_WORKLOAD.measuredSeconds}s`,
          gracefulStop: '30s',
          tags: scenarioTags,
        }

  return {
    scenarios: {
      p2_baseline: execution,
    },
    thresholds: {
      'perf_unexpected_response_rate{perf_phase:measured}': [
        {
          threshold: 'rate<0.01',
          abortOnFail: false,
        },
      ],
      'perf_expected_duration_ms{perf_phase:measured}': [
        {
          threshold: 'p(95)>=0',
          abortOnFail: false,
        },
      ],
      'perf_response_bytes{perf_phase:measured}': [
        {
          threshold: 'p(95)>=0',
          abortOnFail: false,
        },
      ],
    },
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

export function resolveScenarioIteration({ run, virtualUserId, iterationInScenario, elapsedMs }) {
  const scenario = validateRunDescriptor(run)

  if (!Number.isInteger(virtualUserId) || virtualUserId < 1 || virtualUserId > run.vus) {
    fail('virtual-user ID is outside the run')
  }

  if (!Number.isInteger(iterationInScenario) || iterationInScenario < 0) {
    fail('scenario iteration is invalid')
  }

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    fail('scenario elapsed time is invalid')
  }

  if (scenario.workload === 'finite-write') {
    const totalIterations =
      P2_WRITE_WORKLOAD.warmupIterations + P2_WRITE_WORKLOAD.measuredIterations

    if (iterationInScenario >= totalIterations) {
      fail('S5 iteration is outside the approved run')
    }

    const phase = iterationInScenario < P2_WRITE_WORKLOAD.warmupIterations ? 'warmup' : 'measured'

    const phaseIteration =
      phase === 'warmup'
        ? iterationInScenario
        : iterationInScenario - P2_WRITE_WORKLOAD.warmupIterations

    const writeSequence = selectP2WriteSequence({
      vus: run.vus,
      repetition: run.repetition,
      phase,
      iteration: phaseIteration,
    })

    return Object.freeze({
      phase,
      writeSequence,
    })
  }

  const warmupMilliseconds = P2_TIMED_WORKLOAD.warmupSeconds * 1000

  const totalMilliseconds =
    (P2_TIMED_WORKLOAD.warmupSeconds + P2_TIMED_WORKLOAD.measuredSeconds) * 1000

  if (elapsedMs >= totalMilliseconds) {
    return null
  }

  return Object.freeze({
    phase: elapsedMs < warmupMilliseconds ? 'warmup' : 'measured',
    writeSequence: null,
  })
}

export function executeScenarioRunIteration(
  { run, virtualUserId, iterationInScenario, elapsedMs },
  dependencies,
) {
  const scenario = validateRunDescriptor(run)

  validateDependencies(dependencies)

  const coordinate = resolveScenarioIteration({
    run,
    virtualUserId,
    iterationInScenario,
    elapsedMs,
  })

  if (coordinate === null) {
    return Object.freeze({
      executed: false,
      scenarioId: scenario.id,
      phase: null,
      secretsReturned: false,
    })
  }

  const metadata = callStage('fixture metadata lookup', () => dependencies.getFixtureMetadata())

  if (!isObject(metadata)) {
    fail('fixture metadata is invalid')
  }

  const plan = callStage('request planning', () =>
    buildScenarioRequestPlan({
      scenarioId: scenario.id,
      virtualUserId,
      writeSequence: coordinate.writeSequence,
      metadata,
    }),
  )

  let tokenUser = null
  let loginPassword = null

  if (scenario.authentication === 'bearer') {
    tokenUser = callStage('token lookup', () =>
      dependencies.getTokenUserBySequence(plan.userSequence, plan.pool),
    )
  }

  if (scenario.authentication === 'credentials') {
    loginPassword = callStage('login-password lookup', () => dependencies.readLoginPassword())
  }

  const outcome = callStage('HTTP execution', () =>
    dependencies.executeScenarioHttpRequest({
      plan,
      baseUrl: run.baseUrl,
      phase: coordinate.phase,
      tokenUser,
      loginPassword,
    }),
  )

  const metricSummary = callStage('metric recording', () =>
    dependencies.recordScenarioMetrics(outcome),
  )

  const safeSummary = validateMetricSummary(metricSummary, scenario, coordinate.phase)

  return Object.freeze({
    executed: true,
    ...safeSummary,
  })
}
