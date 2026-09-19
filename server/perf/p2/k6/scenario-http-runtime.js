import http from 'k6/http'

import { executeScenarioHttpRequest } from './scenario-http-contracts.mjs'

export function executeK6ScenarioHttpRequest(input) {
  return executeScenarioHttpRequest({
    ...input,
    httpClient: http,
  })
}
