import { POOLS } from '../../fixture-config.mjs'

import { PERF_LOGIN_PASSWORD_BYTES, POOL_A_ALLOCATIONS } from '../baseline-config.mjs'
import { getBaselineScenario } from '../baseline-contracts.mjs'
import { classifyScenarioResponse } from '../response-contracts.mjs'

const ALLOWED_PHASES = new Set(['warmup', 'measured'])

function fail(message) {
  throw new Error(`Invalid PERF-P2 HTTP request: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) {
    return false
  }

  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()

  return JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys)
}

function utf8ByteLength(value) {
  let bytes = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const nextCode = value.charCodeAt(index + 1)

      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }

  return bytes
}

export function normalizeScenarioHttpsOrigin(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl !== baseUrl.trim()) {
    fail('base URL is unavailable')
  }

  if (!baseUrl.startsWith('https://')) {
    fail('base URL must use HTTPS')
  }

  let authority = baseUrl.slice('https://'.length)

  if (authority.endsWith('/')) {
    authority = authority.slice(0, -1)
  }

  if (authority.length === 0 || /[/\\?#@\s]/.test(authority)) {
    fail('base URL must contain only an HTTPS origin')
  }

  const match = authority.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i)

  if (!match) {
    fail('base URL hostname is invalid')
  }

  const hostname = match[1]
  const port = match[2]

  if (
    !hostname.includes('.') ||
    hostname.includes('..') ||
    hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) {
    fail('base URL hostname is invalid')
  }

  if (port && Number(port) > 65535) {
    fail('base URL port is invalid')
  }

  return `https://${authority}`
}

function validatePhase(phase) {
  if (!ALLOWED_PHASES.has(phase)) {
    fail('phase must be warmup or measured')
  }
}

function validateScenarioPlan(plan) {
  if (!isObject(plan)) {
    fail('scenario plan is unavailable')
  }

  let scenario

  try {
    scenario = getBaselineScenario(plan.scenarioId)
  } catch {
    fail('scenario is not approved')
  }

  if (
    plan.name !== scenario.name ||
    plan.method !== scenario.method ||
    plan.path !== scenario.path ||
    plan.pool !== scenario.pool ||
    plan.authentication !== scenario.authentication ||
    plan.workload !== scenario.workload
  ) {
    fail('scenario plan differs from the frozen configuration')
  }

  if (
    !isObject(plan.expectation) ||
    plan.expectation.status !== scenario.expectedStatus ||
    plan.expectation.code !== (scenario.expectedCode ?? null) ||
    plan.expectation.responseContract !== scenario.responseContract
  ) {
    fail('scenario response expectation is invalid')
  }

  if (scenario.pool === null) {
    if (plan.userSequence !== null) {
      fail('unauthenticated scenario unexpectedly selects a user')
    }
  } else {
    const pool = POOLS[scenario.pool]

    if (
      !pool ||
      !Number.isInteger(plan.userSequence) ||
      plan.userSequence < pool.firstSeq ||
      plan.userSequence > pool.lastSeq
    ) {
      fail('scenario user is outside the approved pool')
    }
  }

  if (scenario.id === 'S1') {
    if (
      plan.userSequence !== scenario.userSeq ||
      !hasExactKeys(plan.body, ['email']) ||
      typeof plan.body.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(plan.body.email)
    ) {
      fail('login request plan is invalid')
    }
  } else if (scenario.id === 'S5' || scenario.id === 'S6') {
    if (
      !hasExactKeys(plan.body, ['answer', 'characterId']) ||
      !Number.isInteger(plan.body.characterId) ||
      plan.body.characterId <= 0 ||
      typeof plan.body.answer !== 'string' ||
      plan.body.answer.length === 0
    ) {
      fail('session request plan is invalid')
    }

    if (
      scenario.id === 'S5' &&
      (plan.userSequence < POOL_A_ALLOCATIONS.p2WriteReserve.firstSeq ||
        plan.userSequence > POOL_A_ALLOCATIONS.p2WriteReserve.lastSeq ||
        plan.expectation.expectedCharacterId !== plan.body.characterId)
    ) {
      fail('S5 request plan is outside the approved reserve')
    }
  } else if (plan.body !== null) {
    fail('read-only scenario unexpectedly contains a request body')
  }

  if (
    scenario.id === 'S2' &&
    (typeof plan.expectation.expectedTodayAnswer !== 'string' ||
      plan.expectation.expectedTodayAnswer.length === 0)
  ) {
    fail('today-character expectation is invalid')
  }

  return scenario
}

function validateBearerUser(plan, tokenUser) {
  if (
    !isObject(tokenUser) ||
    tokenUser.sequence !== plan.userSequence ||
    tokenUser.pool !== plan.pool ||
    typeof tokenUser.token !== 'string' ||
    tokenUser.token.length === 0 ||
    /\s/.test(tokenUser.token)
  ) {
    fail('bearer user does not match the scenario plan')
  }

  return tokenUser.token
}

function validateLoginPassword(password) {
  if (typeof password !== 'string' || /[\u0000\r\n]/.test(password)) {
    fail('login password is unavailable')
  }

  const bytes = utf8ByteLength(password)

  if (bytes < PERF_LOGIN_PASSWORD_BYTES.minimum || bytes > PERF_LOGIN_PASSWORD_BYTES.maximum) {
    fail('login password is outside the approved byte range')
  }

  return password
}

function buildRequestBody(plan, loginPassword) {
  if (plan.scenarioId === 'S1') {
    return JSON.stringify({
      email: plan.body.email,
      password: validateLoginPassword(loginPassword),
    })
  }

  if (plan.scenarioId === 'S5' || plan.scenarioId === 'S6') {
    return JSON.stringify({
      characterId: plan.body.characterId,
      answer: plan.body.answer,
    })
  }

  return null
}

function parseResponseBody(body) {
  if (typeof body !== 'string' || body.length === 0) {
    return null
  }

  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function safeDuration(response) {
  const duration = response?.timings?.duration

  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

function classifyResponse(plan, phase, response) {
  const status =
    Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
      ? response.status
      : 0

  const body = typeof response?.body === 'string' ? response.body : ''

  const classification = classifyScenarioResponse({
    scenarioId: plan.scenarioId,
    status,
    body: parseResponseBody(body),
    expectedTodayAnswer: plan.expectation.expectedTodayAnswer,
    expectedCharacterId: plan.expectation.expectedCharacterId,
  })

  return {
    scenarioId: plan.scenarioId,
    phase,
    userSequence: plan.userSequence,
    expected: classification.expected,
    category: classification.category,
    status: classification.status,
    reasons: classification.reasons,
    durationMs: safeDuration(response),
    responseBytes: utf8ByteLength(body),
    requestAttempted: true,
    transportCompleted: status !== 0,
    secretsReturned: false,
  }
}

function validateHttpClient(httpClient) {
  if (
    !isObject(httpClient) ||
    typeof httpClient.request !== 'function' ||
    typeof httpClient.expectedStatuses !== 'function'
  ) {
    fail('HTTP client is incomplete')
  }
}

export function buildScenarioHttpRequest({
  plan,
  baseUrl,
  phase,
  tokenUser = null,
  loginPassword = null,
  responseCallback,
}) {
  const scenario = validateScenarioPlan(plan)
  const origin = normalizeScenarioHttpsOrigin(baseUrl)

  validatePhase(phase)

  if (responseCallback === null || responseCallback === undefined) {
    fail('expected-status callback is unavailable')
  }

  const headers = {
    Accept: 'application/json',
  }

  if (scenario.authentication === 'none') {
    if (tokenUser !== null || loginPassword !== null) {
      fail('unauthenticated scenario received credentials')
    }
  } else if (scenario.authentication === 'credentials') {
    if (tokenUser !== null) {
      fail('login scenario received a bearer user')
    }
  } else if (scenario.authentication === 'bearer') {
    if (loginPassword !== null) {
      fail('bearer scenario received a login password')
    }

    headers.Authorization = `Bearer ${validateBearerUser(plan, tokenUser)}`
  } else {
    fail('scenario authentication mode is invalid')
  }

  const body = buildRequestBody(plan, loginPassword)

  if (body !== null) {
    headers['Content-Type'] = 'application/json'
  }

  return {
    method: scenario.method,
    url: `${origin}${scenario.path}`,
    body,
    params: {
      headers,
      redirects: 0,
      timeout: '30s',
      responseType: 'text',
      responseCallback,
      tags: {
        name: `${scenario.id} ${scenario.method} ${scenario.path}`,
        perf_scenario: scenario.id,
        perf_pool: scenario.pool ?? 'none',
        perf_workload: scenario.workload,
        perf_phase: phase,
        expected_status: String(scenario.expectedStatus),
      },
    },
  }
}

export function executeScenarioHttpRequest({
  httpClient,
  plan,
  baseUrl,
  phase,
  tokenUser = null,
  loginPassword = null,
}) {
  validateHttpClient(httpClient)
  validateScenarioPlan(plan)
  validatePhase(phase)

  let responseCallback

  try {
    responseCallback = httpClient.expectedStatuses(plan.expectation.status)
  } catch {
    fail('expected-status callback could not be created')
  }

  const request = buildScenarioHttpRequest({
    plan,
    baseUrl,
    phase,
    tokenUser,
    loginPassword,
    responseCallback,
  })

  let response

  try {
    response = httpClient.request(request.method, request.url, request.body, request.params)
  } catch {
    // Status 0 is always unexpected, so this synthetic 0 ms value never enters the latency trend.
    response = {
      status: 0,
      body: '',
      timings: {
        duration: 0,
      },
    }
  }

  return classifyResponse(plan, phase, response)
}
