import assert from 'node:assert/strict'
import test from 'node:test'

import { POOLS } from '../fixture-config.mjs'

import {
  buildScenarioRequestPlan,
  selectP2WriteSequence,
  selectTimedScenarioUserSequence,
} from './k6/scenario-request-plan.mjs'

const metadata = {
  login: {
    sequence: POOLS.R.firstSeq,
    email: 'player_00001@example.invalid',
  },
  dailyCharacter: {
    id: 274,
    answer: 'synthetic-answer',
  },
}

test('health scenario has no identity or request body', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S0',
  })

  assert.equal(plan.userSequence, null)
  assert.equal(plan.authentication, 'none')
  assert.equal(plan.body, null)
  assert.equal(plan.expectation.status, 200)
})

test('timed read and conflict scenarios rotate within approved pools', () => {
  assert.equal(selectTimedScenarioUserSequence('S2', 1), POOLS.R.firstSeq)
  assert.equal(selectTimedScenarioUserSequence('S3', 900), POOLS.R.lastSeq)
  assert.equal(selectTimedScenarioUserSequence('S4', 901), POOLS.R.firstSeq)

  assert.equal(selectTimedScenarioUserSequence('S6', 1), POOLS.B.firstSeq)
  assert.equal(selectTimedScenarioUserSequence('S6', 200), POOLS.B.lastSeq)
  assert.equal(selectTimedScenarioUserSequence('S6', 201), POOLS.B.firstSeq)
})

test('login scenario uses only the designated identity and public email', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S1',
    virtualUserId: 50,
    metadata,
  })

  assert.equal(plan.userSequence, POOLS.R.firstSeq)
  assert.deepEqual(plan.body, {
    email: metadata.login.email,
  })

  assert.equal(Object.hasOwn(plan.body, 'password'), false)
  assert.equal(Object.hasOwn(plan.body, 'token'), false)
})

test('S5 allocation maps all six rounds to 330 distinct users', () => {
  const sequences = []

  for (const vus of [1, 5]) {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      for (let iteration = 0; iteration < 5; iteration += 1) {
        sequences.push(
          selectP2WriteSequence({
            vus,
            repetition,
            phase: 'warmup',
            iteration,
          }),
        )
      }

      for (let iteration = 0; iteration < 50; iteration += 1) {
        sequences.push(
          selectP2WriteSequence({
            vus,
            repetition,
            phase: 'measured',
            iteration,
          }),
        )
      }
    }
  }

  assert.equal(sequences.length, 330)
  assert.equal(new Set(sequences).size, 330)
  assert.equal(sequences[0], 7301)
  assert.equal(sequences.at(-1), 7630)
})

test('write and conflict plans use the approved daily character', () => {
  const writePlan = buildScenarioRequestPlan({
    scenarioId: 'S5',
    writeSequence: 7301,
    metadata,
  })

  assert.equal(writePlan.pool, 'A')
  assert.equal(writePlan.userSequence, 7301)
  assert.deepEqual(writePlan.body, {
    characterId: metadata.dailyCharacter.id,
    answer: metadata.dailyCharacter.answer,
  })
  assert.equal(writePlan.expectation.expectedCharacterId, metadata.dailyCharacter.id)

  const conflictPlan = buildScenarioRequestPlan({
    scenarioId: 'S6',
    virtualUserId: 1,
    metadata,
  })

  assert.equal(conflictPlan.pool, 'B')
  assert.equal(conflictPlan.userSequence, POOLS.B.firstSeq)
  assert.equal(conflictPlan.expectation.status, 409)
  assert.equal(conflictPlan.expectation.code, 'ALREADY_STUDIED_TODAY')
  assert.deepEqual(conflictPlan.body, writePlan.body)
})

test('invalid timing and write selections fail closed', () => {
  assert.throws(() => selectTimedScenarioUserSequence('S5', 1), /not a timed workload/)

  assert.throws(() => selectTimedScenarioUserSequence('S2', 0), /virtual-user ID/)

  assert.throws(
    () =>
      selectP2WriteSequence({
        vus: 10,
        repetition: 1,
        phase: 'warmup',
        iteration: 0,
      }),
    /round is not approved/,
  )

  assert.throws(
    () =>
      selectP2WriteSequence({
        vus: 1,
        repetition: 1,
        phase: 'setup',
        iteration: 0,
      }),
    /phase must be warmup or measured/,
  )

  assert.throws(
    () =>
      selectP2WriteSequence({
        vus: 1,
        repetition: 1,
        phase: 'measured',
        iteration: 50,
      }),
    /iteration is outside/,
  )
})

test('invalid fixture metadata and write ranges fail closed', () => {
  assert.throws(
    () =>
      buildScenarioRequestPlan({
        scenarioId: 'S1',
        metadata: {
          ...metadata,
          login: {
            ...metadata.login,
            sequence: 2,
          },
        },
      }),
    /wrong user sequence/,
  )

  assert.throws(
    () =>
      buildScenarioRequestPlan({
        scenarioId: 'S2',
        metadata: {
          ...metadata,
          dailyCharacter: {
            ...metadata.dailyCharacter,
            answer: '',
          },
        },
      }),
    /daily-character answer/,
  )

  assert.throws(
    () =>
      buildScenarioRequestPlan({
        scenarioId: 'S5',
        writeSequence: 7300,
        metadata,
      }),
    /outside the P2 write reserve/,
  )

  assert.throws(
    () =>
      buildScenarioRequestPlan({
        scenarioId: 'S3',
        writeSequence: 7301,
        metadata,
      }),
    /valid only for S5/,
  )
})

test('request plans never contain bearer tokens or passwords', () => {
  const plans = [
    buildScenarioRequestPlan({ scenarioId: 'S0' }),
    buildScenarioRequestPlan({ scenarioId: 'S1', metadata }),
    buildScenarioRequestPlan({ scenarioId: 'S2', metadata }),
    buildScenarioRequestPlan({ scenarioId: 'S3', metadata }),
    buildScenarioRequestPlan({ scenarioId: 'S4', metadata }),
    buildScenarioRequestPlan({
      scenarioId: 'S5',
      writeSequence: 7301,
      metadata,
    }),
    buildScenarioRequestPlan({ scenarioId: 'S6', metadata }),
  ]

  const serialized = JSON.stringify(plans)

  assert.equal(serialized.includes('"token"'), false)
  assert.equal(serialized.includes('"password"'), false)
  assert.equal(serialized.includes('DATABASE_URL'), false)
  assert.equal(serialized.includes('JWT_SECRET'), false)
})
