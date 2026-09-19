import exec from 'k6/execution'

import { getBaselineScenario } from '../baseline-contracts.mjs'

import {
  buildScenarioRunOptions,
  executeScenarioRunIteration,
  readScenarioRunConfig,
} from './scenario-run-contracts.mjs'
import { executeK6ScenarioHttpRequest } from './scenario-http-runtime.js'
import { recordK6ScenarioOutcome } from './scenario-metrics-runtime.js'
import { getTokenFixtureMetadata, getTokenUserBySequence } from './shared-token-fixture.js'

const run = readScenarioRunConfig(__ENV)
const scenario = getBaselineScenario(run.scenarioId)

const runtimeDependencies = Object.freeze({
  getFixtureMetadata: getTokenFixtureMetadata,
  getTokenUserBySequence,

  readLoginPassword() {
    return __ENV.PERF_LOGIN_PASSWORD
  },

  executeScenarioHttpRequest: executeK6ScenarioHttpRequest,
  recordScenarioMetrics: recordK6ScenarioOutcome,
})

export const options = buildScenarioRunOptions(run)

function mustAbortForAuthentication(summary) {
  if (!summary.executed) {
    return false
  }

  if (scenario.id === 'S1') {
    return summary.expected !== true
  }

  return scenario.authentication === 'bearer' && summary.status === 401
}

export function runP2Scenario() {
  const summary = executeScenarioRunIteration(
    {
      run,
      virtualUserId: exec.vu.idInTest,
      iterationInScenario: exec.scenario.iterationInTest,
      elapsedMs: Date.now() - exec.scenario.startTime,
    },
    runtimeDependencies,
  )

  if (mustAbortForAuthentication(summary)) {
    exec.test.abort('PERF-P2 authentication safety gate failed')
  }

  return summary
}

export function handleSummary(data) {
  const label = `p2-${run.scenarioId}-vu${run.vus}-rep${run.repetition}`

  // The task filesystem disappears on exit, so emit one machine-readable result to stdout.
  return {
    stdout: `PERF_RESULT ${label} ${JSON.stringify(data)}\n`,
  }
}

export default runP2Scenario
