import { POOLS } from '../fixture-config.mjs'

import {
  BASELINE_SCENARIOS,
  P2_LEVELS,
  P2_REPETITIONS,
  P2_TIMED_WORKLOAD,
  P2_WRITE_WORKLOAD,
  PERF_LOGIN_PASSWORD_BYTES,
  POOL_A_ALLOCATIONS,
} from './baseline-config.mjs'

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(`Invalid PERF-P2 configuration: ${message}`)
  }
}

function assertRange(range, name) {
  assertCondition(
    Number.isInteger(range.firstSeq) &&
      Number.isInteger(range.lastSeq) &&
      Number.isInteger(range.users),
    `${name} must contain integer sequence values`,
  )

  assertCondition(range.firstSeq <= range.lastSeq, `${name} has an invalid sequence order`)

  assertCondition(
    range.users === range.lastSeq - range.firstSeq + 1,
    `${name} has an incorrect user count`,
  )
}

function rangeContains(outerRange, innerRange) {
  return innerRange.firstSeq >= outerRange.firstSeq && innerRange.lastSeq <= outerRange.lastSeq
}

function rangesAreAdjacent(leftRange, rightRange) {
  return leftRange.lastSeq + 1 === rightRange.firstSeq
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function roundUpTo50Milliseconds(value) {
  return Math.ceil(value / 50) * 50
}

export function getBaselineScenario(scenarioId) {
  const scenario = BASELINE_SCENARIOS.find((candidate) => candidate.id === scenarioId)

  if (!scenario) {
    throw new Error(`Unknown PERF-P2 scenario: ${scenarioId}`)
  }

  return scenario
}

export function validateBaselineConfig() {
  assertCondition(
    JSON.stringify(P2_LEVELS) === JSON.stringify([1, 5]),
    'VU levels must remain exactly 1 and 5',
  )

  assertCondition(P2_REPETITIONS === 3, 'each VU level must run exactly three repetitions')

  assertCondition(
    P2_TIMED_WORKLOAD.warmupSeconds === 30 && P2_TIMED_WORKLOAD.measuredSeconds === 60,
    'timed workloads must use 30 seconds of warm-up and 60 seconds of measurement',
  )

  assertCondition(
    P2_WRITE_WORKLOAD.warmupIterations === 5 && P2_WRITE_WORKLOAD.measuredIterations === 50,
    'S5 must use 5 warm-up writes and 50 measured writes',
  )

  assertCondition(
    PERF_LOGIN_PASSWORD_BYTES.minimum === 32 && PERF_LOGIN_PASSWORD_BYTES.maximum === 72,
    'the login password boundary must remain 32 through 72 UTF-8 bytes',
  )

  const primaryAllocations = [
    POOL_A_ALLOCATIONS.baselineIsolated,
    POOL_A_ALLOCATIONS.comparisonIsolated,
    POOL_A_ALLOCATIONS.baselineMixed,
    POOL_A_ALLOCATIONS.comparisonMixed,
    POOL_A_ALLOCATIONS.operationalReserve,
  ]

  for (const [index, range] of primaryAllocations.entries()) {
    assertRange(range, `Pool A allocation ${index + 1}`)
    assertCondition(
      rangeContains(POOLS.A, range),
      `Pool A allocation ${index + 1} is outside Pool A`,
    )
  }

  assertCondition(
    primaryAllocations[0].firstSeq === POOLS.A.firstSeq,
    'Pool A allocations do not start at the first Pool A user',
  )

  assertCondition(
    primaryAllocations.at(-1).lastSeq === POOLS.A.lastSeq,
    'Pool A allocations do not end at the last Pool A user',
  )

  for (let index = 1; index < primaryAllocations.length; index += 1) {
    assertCondition(
      rangesAreAdjacent(primaryAllocations[index - 1], primaryAllocations[index]),
      'Pool A primary allocations must be adjacent and non-overlapping',
    )
  }

  assertRange(POOL_A_ALLOCATIONS.p2WriteReserve, 'P2 write reserve')

  assertRange(POOL_A_ALLOCATIONS.unusedReserve, 'unused operational reserve')

  assertCondition(
    rangeContains(POOL_A_ALLOCATIONS.operationalReserve, POOL_A_ALLOCATIONS.p2WriteReserve),
    'the P2 write reserve is outside the operational reserve',
  )

  assertCondition(
    rangesAreAdjacent(POOL_A_ALLOCATIONS.p2WriteReserve, POOL_A_ALLOCATIONS.unusedReserve),
    'the P2 and unused reserves must be adjacent',
  )

  const expectedP2WriteUsers =
    P2_LEVELS.length *
    P2_REPETITIONS *
    (P2_WRITE_WORKLOAD.warmupIterations + P2_WRITE_WORKLOAD.measuredIterations)

  assertCondition(
    POOL_A_ALLOCATIONS.p2WriteReserve.users === expectedP2WriteUsers,
    'the P2 write reserve does not match the planned write count',
  )

  const scenarioIds = BASELINE_SCENARIOS.map((scenario) => scenario.id)

  assertCondition(
    JSON.stringify(scenarioIds) === JSON.stringify(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']),
    'the scenario list must contain S0 through S6 in order',
  )

  assertCondition(new Set(scenarioIds).size === scenarioIds.length, 'scenario IDs must be unique')

  assertCondition(
    BASELINE_SCENARIOS.every(
      (scenario) => scenario.path !== '/api/auth/register' && scenario.id !== 'S7',
    ),
    'registration and S7 must remain outside PERF-P2',
  )

  const loginScenario = getBaselineScenario('S1')
  const writeScenario = getBaselineScenario('S5')
  const conflictScenario = getBaselineScenario('S6')

  assertCondition(
    loginScenario.pool === 'R' &&
      loginScenario.userSeq === POOLS.R.firstSeq &&
      loginScenario.authentication === 'credentials',
    'S1 must use the designated Pool R login identity',
  )

  assertCondition(
    writeScenario.pool === 'A' &&
      writeScenario.workload === 'finite-write' &&
      writeScenario.expectedStatus === 201 &&
      writeScenario.userRange === POOL_A_ALLOCATIONS.p2WriteReserve,
    'S5 must use the finite Pool A write reserve',
  )

  assertCondition(
    conflictScenario.pool === 'B' &&
      conflictScenario.expectedStatus === 409 &&
      conflictScenario.expectedCode === 'ALREADY_STUDIED_TODAY',
    'S6 must require the approved Pool B conflict result',
  )

  return {
    scenarios: scenarioIds.length,
    levels: [...P2_LEVELS],
    repetitions: P2_REPETITIONS,
    p2WriteUsers: expectedP2WriteUsers,
  }
}

export function buildP2WriteAllocationPlan() {
  validateBaselineConfig()

  const plan = []
  let nextSequence = POOL_A_ALLOCATIONS.p2WriteReserve.firstSeq

  for (const vus of P2_LEVELS) {
    for (let repetition = 1; repetition <= P2_REPETITIONS; repetition += 1) {
      const warmupSequences = Array.from(
        { length: P2_WRITE_WORKLOAD.warmupIterations },
        () => nextSequence++,
      )

      const measuredSequences = Array.from(
        { length: P2_WRITE_WORKLOAD.measuredIterations },
        () => nextSequence++,
      )

      plan.push({
        vus,
        repetition,
        warmupSequences,
        measuredSequences,
      })
    }
  }

  assertCondition(
    nextSequence - 1 === POOL_A_ALLOCATIONS.p2WriteReserve.lastSeq,
    'the S5 allocation plan did not consume the exact reserve',
  )

  return plan
}

export function deriveLatencyThresholds(runSummaries) {
  assertCondition(
    Array.isArray(runSummaries) && runSummaries.length === P2_REPETITIONS,
    `latency thresholds require exactly ${P2_REPETITIONS} run summaries`,
  )

  for (const [index, run] of runSummaries.entries()) {
    assertCondition(
      Number.isFinite(run.p50Ms) && run.p50Ms > 0 && Number.isFinite(run.p95Ms) && run.p95Ms > 0,
      `run ${index + 1} contains invalid latency values`,
    )

    assertCondition(run.p95Ms >= run.p50Ms, `run ${index + 1} has p95 below p50`)
  }

  const baselineP50Ms = median(runSummaries.map((run) => run.p50Ms))

  const baselineP95Ms = median(runSummaries.map((run) => run.p95Ms))

  return {
    baselineP50Ms,
    baselineP95Ms,
    p50ThresholdMs: roundUpTo50Milliseconds(baselineP50Ms * 2),
    p95ThresholdMs: roundUpTo50Milliseconds(baselineP95Ms * 3),
  }
}
