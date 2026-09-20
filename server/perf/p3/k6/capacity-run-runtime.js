import exec from 'k6/execution'

import { getBaselineScenario } from '../../p2/baseline-contracts.mjs'
import { executeK6ScenarioHttpRequest } from '../../p2/k6/scenario-http-runtime.js'
import { recordK6ScenarioOutcome } from '../../p2/k6/scenario-metrics-runtime.js'
import { buildScenarioRequestPlan } from '../../p2/k6/scenario-request-plan.mjs'
import {
  getTokenFixtureMetadata,
  getTokenUserBySequence,
} from '../../p2/k6/shared-token-fixture.js'
import {
  buildP3CapacityRunOptions,
  buildP3CapacitySummary,
  readP3CapacityRunConfig,
  resolveP3CapacityPhase,
} from '../capacity-contracts.mjs'

const run = readP3CapacityRunConfig(__ENV)
const scenario = getBaselineScenario(run.scenarioId)

export const options = buildP3CapacityRunOptions(run)

function mustAbortForAuthentication(summary) {
  if (scenario.id === 'S1') {
    return summary.expected !== true
  }

  return scenario.authentication === 'bearer' && summary.status === 401
}

export function runP3CapacityScenario() {
  const phase = resolveP3CapacityPhase(Date.now() - exec.scenario.startTime)

  if (phase === null) {
    return null
  }

  const plan = buildScenarioRequestPlan({
    scenarioId: scenario.id,
    virtualUserId: exec.vu.idInTest,
    metadata: getTokenFixtureMetadata(),
  })

  const tokenUser =
    scenario.authentication === 'bearer'
      ? getTokenUserBySequence(plan.userSequence, plan.pool)
      : null

  const loginPassword = scenario.authentication === 'credentials' ? __ENV.PERF_LOGIN_PASSWORD : null

  const outcome = executeK6ScenarioHttpRequest({
    plan,
    baseUrl: run.baseUrl,
    phase,
    tokenUser,
    loginPassword,
  })

  const summary = recordK6ScenarioOutcome(outcome)

  if (mustAbortForAuthentication(summary)) {
    exec.test.abort('PERF-P3 authentication safety gate failed')
  }

  return summary
}

export function handleSummary(data) {
  return {
    stdout: `PERF_RESULT ${JSON.stringify(buildP3CapacitySummary(run, data))}\n`,
  }
}

export default runP3CapacityScenario
