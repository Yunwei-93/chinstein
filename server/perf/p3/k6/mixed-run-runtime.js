import exec from 'k6/execution'

import { executeK6ScenarioHttpRequest } from '../../p2/k6/scenario-http-runtime.js'
import { recordK6ScenarioOutcome } from '../../p2/k6/scenario-metrics-runtime.js'
import { buildScenarioRequestPlan } from '../../p2/k6/scenario-request-plan.mjs'
import {
  getTokenFixtureMetadata,
  getTokenUserBySequence,
} from '../../p2/k6/shared-token-fixture.js'
import {
  buildP3MixedRunOptions,
  buildP3MixedSummary,
  buildP3MixedWriteRequestPlan,
  readP3MixedRunConfig,
  resolveP3MixedReadPhase,
  selectP3MixedWriteSequence,
} from '../mixed-contracts.mjs'

const run = readP3MixedRunConfig(__ENV)

export const options = buildP3MixedRunOptions(run)

export function runP3MixedReadScenario() {
  const phase = resolveP3MixedReadPhase(Date.now() - exec.scenario.startTime)

  if (phase === null) return null

  const plan = buildScenarioRequestPlan({
    scenarioId: run.readScenarioId,
    virtualUserId: exec.vu.idInTest,
    metadata: getTokenFixtureMetadata(),
  })
  const outcome = executeK6ScenarioHttpRequest({
    plan,
    baseUrl: run.baseUrl,
    phase,
    tokenUser: getTokenUserBySequence(plan.userSequence, plan.pool),
    loginPassword: null,
  })
  const summary = recordK6ScenarioOutcome(outcome)

  if (summary.status === 401) {
    exec.test.abort('PERF-P3 mixed read authentication safety gate failed')
  }

  return summary
}

export function runP3MixedWriteScenario() {
  const sequence = selectP3MixedWriteSequence(exec.scenario.iterationInTest)
  const plan = buildP3MixedWriteRequestPlan({
    sequence,
    metadata: getTokenFixtureMetadata(),
  })
  const outcome = executeK6ScenarioHttpRequest({
    plan,
    baseUrl: run.baseUrl,
    phase: 'measured',
    tokenUser: getTokenUserBySequence(sequence, 'A'),
    loginPassword: null,
  })
  const summary = recordK6ScenarioOutcome(outcome)

  if (summary.status === 401) {
    exec.test.abort('PERF-P3 mixed write authentication safety gate failed')
  }

  return summary
}

export function handleSummary(data) {
  return {
    stdout: `PERF_RESULT ${JSON.stringify(buildP3MixedSummary(run, data))}\n`,
  }
}
