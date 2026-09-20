import exec from 'k6/execution'

import { executeK6ScenarioHttpRequest } from '../../p2/k6/scenario-http-runtime.js'
import { recordK6ScenarioOutcome } from '../../p2/k6/scenario-metrics-runtime.js'
import {
  getTokenFixtureMetadata,
  getTokenUserBySequence,
} from '../../p2/k6/shared-token-fixture.js'
import {
  buildP3WriteRequestPlan,
  buildP3WriteRunOptions,
  buildP3WriteSummary,
  readP3WriteRunConfig,
  selectP3WriteSequence,
} from '../write-contracts.mjs'

const run = readP3WriteRunConfig(__ENV)

export const options = buildP3WriteRunOptions(run)

export function runP3WriteScenario() {
  const sequence = selectP3WriteSequence({
    vus: run.vus,
    repetition: run.repetition,
    iteration: exec.scenario.iterationInTest,
  })

  const plan = buildP3WriteRequestPlan({
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
    exec.test.abort('PERF-P3 write authentication safety gate failed')
  }

  return summary
}

export function handleSummary(data) {
  return {
    stdout: `PERF_RESULT ${JSON.stringify(buildP3WriteSummary(run, data))}\n`,
  }
}

export default runP3WriteScenario
