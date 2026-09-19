import { check } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

import { recordScenarioMetrics } from './scenario-metrics-contracts.mjs'

const metrics = Object.freeze({
  attempted: new Counter('perf_requests_total'),
  expected: new Counter('perf_expected_responses_total'),
  unexpected: new Counter('perf_unexpected_responses_total'),
  unexpectedRate: new Rate('perf_unexpected_response_rate'),
  expectedDuration: new Trend('perf_expected_duration_ms', true),
  responseBytes: new Trend('perf_response_bytes', false),
})

export function recordK6ScenarioOutcome(outcome) {
  return recordScenarioMetrics({
    outcome,
    metrics,
    checkFunction: check,
  })
}
