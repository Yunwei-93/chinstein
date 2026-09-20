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

  // Emit only the submetrics needed by the report so the result fits one log event.
  const measured = (name) => {
    const metric = data.metrics[`${name}{perf_phase:measured}`]

    return metric ? metric.values : null
  }

  const counter = (name) => {
    const metric = data.metrics[name]

    return metric ? metric.values.count : null
  }

  const result = {
    label,
    scenario: run.scenarioId,
    vus: run.vus,
    repetition: run.repetition,
    duration: measured('perf_expected_duration_ms'),
    bytes: measured('perf_response_bytes'),
    unexpectedRate: measured('perf_unexpected_response_rate'),
    attempted: counter('perf_requests_total'),
    expected: counter('perf_expected_responses_total'),
    unexpected: counter('perf_unexpected_responses_total'),
  }

  // The task filesystem disappears on exit, so emit the result to stdout.
  return {
    stdout: `PERF_RESULT ${JSON.stringify(result)}\n`,
  }
}

export default runP2Scenario
