import { POOLS } from '../../fixture-config.mjs'

import { POOL_A_ALLOCATIONS } from '../baseline-config.mjs'
import { buildP2WriteAllocationPlan, getBaselineScenario } from '../baseline-contracts.mjs'

function fail(message) {
  throw new Error(`Invalid PERF-P2 scenario plan: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sequenceForVirtualUser(pool, virtualUserId) {
  if (!Number.isInteger(virtualUserId) || virtualUserId <= 0) {
    fail('virtual-user ID must be a positive integer')
  }

  return pool.firstSeq + ((virtualUserId - 1) % pool.users)
}

function readLoginIdentity(metadata, expectedSequence) {
  if (!isObject(metadata?.login)) {
    fail('login fixture metadata is unavailable')
  }

  if (metadata.login.sequence !== expectedSequence) {
    fail('login fixture uses the wrong user sequence')
  }

  if (typeof metadata.login.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(metadata.login.email)) {
    fail('login fixture email is invalid')
  }

  return {
    sequence: metadata.login.sequence,
    email: metadata.login.email,
  }
}

function readDailyCharacter(metadata) {
  if (!isObject(metadata?.dailyCharacter)) {
    fail('daily-character fixture metadata is unavailable')
  }

  if (!Number.isInteger(metadata.dailyCharacter.id) || metadata.dailyCharacter.id <= 0) {
    fail('daily-character ID is invalid')
  }

  if (
    typeof metadata.dailyCharacter.answer !== 'string' ||
    metadata.dailyCharacter.answer.length === 0
  ) {
    fail('daily-character answer is invalid')
  }

  return {
    id: metadata.dailyCharacter.id,
    answer: metadata.dailyCharacter.answer,
  }
}

function assertP2WriteSequence(sequence) {
  const range = POOL_A_ALLOCATIONS.p2WriteReserve

  if (!Number.isInteger(sequence) || sequence < range.firstSeq || sequence > range.lastSeq) {
    fail('S5 user sequence is outside the P2 write reserve')
  }
}

export function selectTimedScenarioUserSequence(scenarioId, virtualUserId) {
  const scenario = getBaselineScenario(scenarioId)

  if (scenario.workload !== 'timed') {
    fail('scenario is not a timed workload')
  }

  if (scenario.pool === null) {
    return null
  }

  if (scenario.id === 'S1') {
    return scenario.userSeq
  }

  const pool = POOLS[scenario.pool]

  if (!pool) {
    fail('scenario references an unknown user pool')
  }

  return sequenceForVirtualUser(pool, virtualUserId)
}

export function selectP2WriteSequence({ vus, repetition, phase, iteration }) {
  const round = buildP2WriteAllocationPlan().find(
    (candidate) => candidate.vus === vus && candidate.repetition === repetition,
  )

  if (!round) {
    fail('requested S5 round is not approved')
  }

  if (phase !== 'warmup' && phase !== 'measured') {
    fail('S5 phase must be warmup or measured')
  }

  const sequences = phase === 'warmup' ? round.warmupSequences : round.measuredSequences

  if (!Number.isInteger(iteration) || iteration < 0 || iteration >= sequences.length) {
    fail('S5 iteration is outside the approved phase')
  }

  return sequences[iteration]
}

export function buildScenarioRequestPlan({
  scenarioId,
  virtualUserId = 1,
  writeSequence = null,
  metadata = null,
}) {
  const scenario = getBaselineScenario(scenarioId)

  let userSequence = null
  let body = null
  let expectedTodayAnswer = null
  let expectedCharacterId = null

  if (scenario.id === 'S5') {
    assertP2WriteSequence(writeSequence)
    userSequence = writeSequence
  } else {
    if (writeSequence !== null) {
      fail('a write sequence is valid only for S5')
    }

    userSequence = selectTimedScenarioUserSequence(scenario.id, virtualUserId)
  }

  if (scenario.id === 'S1') {
    const login = readLoginIdentity(metadata, userSequence)

    body = {
      email: login.email,
    }
  }

  if (scenario.id === 'S2') {
    const dailyCharacter = readDailyCharacter(metadata)

    expectedTodayAnswer = dailyCharacter.answer
  }

  if (scenario.id === 'S5' || scenario.id === 'S6') {
    const dailyCharacter = readDailyCharacter(metadata)

    body = {
      characterId: dailyCharacter.id,
      answer: dailyCharacter.answer,
    }

    if (scenario.id === 'S5') {
      expectedCharacterId = dailyCharacter.id
    }
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    method: scenario.method,
    path: scenario.path,
    pool: scenario.pool,
    userSequence,
    authentication: scenario.authentication,
    workload: scenario.workload,
    body,
    expectation: {
      status: scenario.expectedStatus,
      code: scenario.expectedCode ?? null,
      responseContract: scenario.responseContract,
      expectedTodayAnswer,
      expectedCharacterId,
    },
  }
}
