import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildP2WriteAllocationPlan,
  deriveLatencyThresholds,
  getBaselineScenario,
  validateBaselineConfig,
} from './baseline-contracts.mjs'

import { classifyScenarioResponse } from './response-contracts.mjs'

test('baseline configuration matches the frozen P2 contract', () => {
  assert.deepEqual(validateBaselineConfig(), {
    scenarios: 7,
    levels: [1, 5],
    repetitions: 3,
    p2WriteUsers: 330,
  })
})

test('S5 allocation uses 330 distinct reserve users', () => {
  const plan = buildP2WriteAllocationPlan()

  assert.equal(plan.length, 6)

  assert.deepEqual(
    plan.map((round) => ({
      vus: round.vus,
      repetition: round.repetition,
    })),
    [
      { vus: 1, repetition: 1 },
      { vus: 1, repetition: 2 },
      { vus: 1, repetition: 3 },
      { vus: 5, repetition: 1 },
      { vus: 5, repetition: 2 },
      { vus: 5, repetition: 3 },
    ],
  )

  for (const round of plan) {
    assert.equal(round.warmupSequences.length, 5)
    assert.equal(round.measuredSequences.length, 50)
  }

  const allSequences = plan.flatMap((round) => [
    ...round.warmupSequences,
    ...round.measuredSequences,
  ])

  assert.equal(allSequences.length, 330)
  assert.equal(new Set(allSequences).size, 330)
  assert.equal(allSequences[0], 7301)
  assert.equal(allSequences.at(-1), 7630)
})

test('latency thresholds use the median and frozen formulas', () => {
  const thresholds = deriveLatencyThresholds([
    { p50Ms: 101, p95Ms: 170 },
    { p50Ms: 126, p95Ms: 190 },
    { p50Ms: 111, p95Ms: 180 },
  ])

  assert.deepEqual(thresholds, {
    baselineP50Ms: 111,
    baselineP95Ms: 180,
    p50ThresholdMs: 250,
    p95ThresholdMs: 550,
  })
})

test('latency thresholds reject invalid summaries', () => {
  assert.throws(
    () =>
      deriveLatencyThresholds([
        { p50Ms: 100, p95Ms: 90 },
        { p50Ms: 100, p95Ms: 110 },
        { p50Ms: 100, p95Ms: 110 },
      ]),
    /p95 below p50/,
  )
})

test('all approved response contracts accept valid examples', () => {
  const examples = [
    {
      scenarioId: 'S0',
      status: 200,
      body: {
        status: 'ok',
        time: '2026-09-18T01:00:00.000Z',
      },
    },
    {
      scenarioId: 'S1',
      status: 200,
      body: {
        token: 'synthetic-token-value',
        user: {
          id: 1,
          name: 'player_00001',
        },
      },
    },
    {
      scenarioId: 'S2',
      status: 200,
      expectedTodayAnswer: 'known-answer',
      body: {
        id: 10,
        character: '学',
        pinyin: 'xué',
        story: 'Synthetic performance story.',
        level: 'Beginner',
        options: ['known-answer', 'other-answer-one', 'other-answer-two'],
      },
    },
    {
      scenarioId: 'S3',
      status: 200,
      body: {
        id: 1,
        name: 'player_00001',
        points: 900,
        streak: 10,
        badges: [],
        learnedCharacterIds: [1, 2, 3],
        completedToday: false,
      },
    },
    {
      scenarioId: 'S4',
      status: 200,
      body: {
        entries: [],
        currentUser: {
          userId: 1,
          name: 'player_00001',
          points: 900,
          rank: 1,
        },
      },
    },
    {
      scenarioId: 'S5',
      status: 201,
      expectedCharacterId: 10,
      body: {
        characterId: 10,
        character: '学',
        meaning: 'known-answer',
        isCorrect: true,
        gainedPoints: 10,
        newBadges: [],
      },
    },
    {
      scenarioId: 'S6',
      status: 409,
      body: {
        error: 'Already studied today',
        code: 'ALREADY_STUDIED_TODAY',
      },
    },
  ]

  for (const example of examples) {
    const result = classifyScenarioResponse(example)

    assert.equal(result.expected, true, `${example.scenarioId} should be accepted`)

    assert.equal(result.category, 'expected')
  }
})

test('today-character rejects leaked meaning and duplicate options', () => {
  const result = classifyScenarioResponse({
    scenarioId: 'S2',
    status: 200,
    expectedTodayAnswer: 'known-answer',
    body: {
      id: 10,
      story: 'Synthetic performance story.',
      meaning: 'known-answer',
      options: ['known-answer', 'known-answer', 'other-answer'],
    },
  })

  assert.equal(result.expected, false)
  assert.equal(result.category, 'contract-error')

  assert.ok(result.reasons.includes('today-character response exposes meaning'))

  assert.ok(result.reasons.includes('today-character options are not distinct'))
})

test('expected 409 requires the approved conflict code', () => {
  const result = classifyScenarioResponse({
    scenarioId: 'S6',
    status: 409,
    body: {
      code: 'NOT_TODAYS_CHARACTER',
    },
  })

  assert.equal(result.expected, false)
  assert.equal(result.category, 'contract-error')
})

test('unexpected statuses remain separately classified', () => {
  const examples = [
    {
      scenarioId: 'S3',
      status: 401,
      category: 'unauthorized',
    },
    {
      scenarioId: 'S1',
      status: 429,
      category: 'rate-limited',
    },
    {
      scenarioId: 'S0',
      status: 503,
      category: 'server-error',
    },
    {
      scenarioId: 'S4',
      status: 0,
      category: 'transport-error',
    },
    {
      scenarioId: 'S6',
      status: 201,
      category: 'unexpected-status',
    },
  ]

  for (const example of examples) {
    const result = classifyScenarioResponse({
      scenarioId: example.scenarioId,
      status: example.status,
      body: null,
    })

    assert.equal(result.expected, false)
    assert.equal(result.category, example.category)
  }
})

test('response classifications never return a login token', () => {
  const token = 'value-that-must-not-appear-in-results'

  const result = classifyScenarioResponse({
    scenarioId: 'S1',
    status: 200,
    body: {
      token,
      user: {
        id: 1,
        name: 'player_00001',
      },
    },
  })

  assert.equal(result.expected, true)
  assert.equal(JSON.stringify(result).includes(token), false)
})

test('unknown scenario IDs fail closed', () => {
  assert.throws(() => getBaselineScenario('S7'), /Unknown PERF-P2 scenario/)
})
