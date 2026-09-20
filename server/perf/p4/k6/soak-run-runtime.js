import exec from 'k6/execution'

import { executeK6ScenarioHttpRequest } from '../../p2/k6/scenario-http-runtime.js'
import { recordK6ScenarioOutcome } from '../../p2/k6/scenario-metrics-runtime.js'
import { buildScenarioRequestPlan } from '../../p2/k6/scenario-request-plan.mjs'
import {
  getTokenFixtureMetadata,
  getTokenUserBySequence,
} from '../../p2/k6/shared-token-fixture.js'
import { buildP4SoakOptions, buildP4SoakSummary, readP4SoakConfig } from '../soak-contracts.mjs'

const run = readP4SoakConfig(__ENV)

export const options = buildP4SoakOptions(run)

function executeSoakRequest(phase) {
  const plan = buildScenarioRequestPlan({
    scenarioId: run.scenarioId,
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
    exec.test.abort('PERF-P4 soak authentication safety gate failed')
  }

  return summary
}

export function runP4SoakWarmup() {
  return executeSoakRequest('warmup')
}

export function runP4SoakOpening() {
  return executeSoakRequest('measured')
}

export function runP4SoakMiddle() {
  return executeSoakRequest('measured')
}

export function runP4SoakClosing() {
  return executeSoakRequest('measured')
}

export function handleSummary(data) {
  return {
    stdout: `PERF_RESULT ${JSON.stringify(buildP4SoakSummary(run, data))}\n`,
  }
}
