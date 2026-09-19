import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { POOLS } from '../fixture-config.mjs'

import { buildScenarioRequestPlan } from './k6/scenario-request-plan.mjs'
import {
  buildScenarioHttpRequest,
  executeScenarioHttpRequest,
} from './k6/scenario-http-contracts.mjs'

const BASE_URL = 'https://staging.example.invalid'
const PRIVATE_TOKEN = 'private-bearer-value'
const PRIVATE_PASSWORD = 'P'.repeat(32)
const PRIVATE_ERROR = 'private-transport-failure'

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

function createHttpClient({
  response = {
    status: 200,
    body: '{}',
    timings: {
      duration: 12.5,
    },
  },
  throwRequest = false,
} = {}) {
  const calls = []

  return {
    calls,

    expectedStatuses(...statuses) {
      return {
        statuses,
      }
    },

    request(method, url, body, params) {
      calls.push({
        method,
        url,
        body,
        params,
      })

      if (throwRequest) {
        throw new Error(`${PRIVATE_ERROR}:${PRIVATE_TOKEN}:${PRIVATE_PASSWORD}`)
      }

      return response
    },
  }
}

function tokenUser(sequence, pool) {
  return {
    sequence,
    userId: sequence + 10000,
    pool,
    token: PRIVATE_TOKEN,
    issuedAt: 1_800_000_000,
    expiresAt: 1_800_014_400,
  }
}

test('builds a tagged HTTPS health request without credentials', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S0',
  })

  const responseCallback = {
    statuses: [200],
  }

  const request = buildScenarioHttpRequest({
    plan,
    baseUrl: `${BASE_URL}/`,
    phase: 'warmup',
    responseCallback,
  })

  assert.equal(request.method, 'GET')
  assert.equal(request.url, `${BASE_URL}/api/health`)
  assert.equal(request.body, null)

  assert.deepEqual(request.params.headers, {
    Accept: 'application/json',
  })

  assert.equal(request.params.redirects, 0)
  assert.equal(request.params.timeout, '30s')
  assert.equal(request.params.responseType, 'text')
  assert.equal(request.params.responseCallback, responseCallback)

  assert.deepEqual(request.params.tags, {
    name: 'S0 GET /api/health',
    perf_scenario: 'S0',
    perf_pool: 'none',
    perf_workload: 'timed',
    perf_phase: 'warmup',
    expected_status: '200',
  })
})

test('injects one matching bearer token into a protected read', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S2',
    virtualUserId: 1,
    metadata,
  })

  const client = createHttpClient({
    response: {
      status: 200,
      body: JSON.stringify({
        id: metadata.dailyCharacter.id,
        story: 'Synthetic performance story.',
        options: [metadata.dailyCharacter.answer, 'other-one', 'other-two'],
      }),
      timings: {
        duration: 18.25,
      },
    },
  })

  const outcome = executeScenarioHttpRequest({
    httpClient: client,
    plan,
    baseUrl: BASE_URL,
    phase: 'measured',
    tokenUser: tokenUser(plan.userSequence, 'R'),
  })

  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].params.headers.Authorization, `Bearer ${PRIVATE_TOKEN}`)

  assert.equal(outcome.expected, true)
  assert.equal(outcome.category, 'expected')
  assert.equal(outcome.status, 200)
  assert.equal(outcome.durationMs, 18.25)
  assert.equal(outcome.transportCompleted, true)

  const serializedOutcome = JSON.stringify(outcome)

  assert.equal(serializedOutcome.includes(PRIVATE_TOKEN), false)
  assert.equal(serializedOutcome.includes(metadata.dailyCharacter.answer), false)
})

test('injects the login password only into the credential request body', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S1',
    metadata,
  })

  const client = createHttpClient({
    response: {
      status: 200,
      body: JSON.stringify({
        token: 'private-response-token',
        user: {
          id: 10001,
          name: 'player_00001',
        },
      }),
      timings: {
        duration: 94,
      },
    },
  })

  const outcome = executeScenarioHttpRequest({
    httpClient: client,
    plan,
    baseUrl: BASE_URL,
    phase: 'measured',
    loginPassword: PRIVATE_PASSWORD,
  })

  const sentBody = JSON.parse(client.calls[0].body)

  assert.deepEqual(sentBody, {
    email: metadata.login.email,
    password: PRIVATE_PASSWORD,
  })

  assert.equal(Object.hasOwn(client.calls[0].params.headers, 'Authorization'), false)

  assert.equal(outcome.expected, true)

  const serializedOutcome = JSON.stringify(outcome)

  assert.equal(serializedOutcome.includes(PRIVATE_PASSWORD), false)
  assert.equal(serializedOutcome.includes('private-response-token'), false)
  assert.equal(serializedOutcome.includes(metadata.login.email), false)
})

test('builds and classifies a successful S5 write', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S5',
    writeSequence: 7301,
    metadata,
  })

  const client = createHttpClient({
    response: {
      status: 201,
      body: JSON.stringify({
        characterId: metadata.dailyCharacter.id,
        isCorrect: true,
        gainedPoints: 10,
        newBadges: [],
      }),
      timings: {
        duration: 24,
      },
    },
  })

  const outcome = executeScenarioHttpRequest({
    httpClient: client,
    plan,
    baseUrl: BASE_URL,
    phase: 'measured',
    tokenUser: tokenUser(7301, 'A'),
  })

  assert.deepEqual(JSON.parse(client.calls[0].body), {
    characterId: metadata.dailyCharacter.id,
    answer: metadata.dailyCharacter.answer,
  })

  assert.equal(client.calls[0].params.headers['Content-Type'], 'application/json')

  assert.deepEqual(client.calls[0].params.responseCallback.statuses, [201])

  assert.equal(outcome.expected, true)
  assert.equal(outcome.status, 201)
})

test('marks the approved S6 conflict as an expected response', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S6',
    virtualUserId: 1,
    metadata,
  })

  const client = createHttpClient({
    response: {
      status: 409,
      body: JSON.stringify({
        error: 'Already studied today',
        code: 'ALREADY_STUDIED_TODAY',
      }),
      timings: {
        duration: 15,
      },
    },
  })

  const outcome = executeScenarioHttpRequest({
    httpClient: client,
    plan,
    baseUrl: BASE_URL,
    phase: 'measured',
    tokenUser: tokenUser(POOLS.B.firstSeq, 'B'),
  })

  assert.deepEqual(client.calls[0].params.responseCallback.statuses, [409])

  assert.equal(outcome.expected, true)
  assert.equal(outcome.category, 'expected')
  assert.equal(outcome.status, 409)
})

test('classifies unexpected statuses and malformed bodies safely', () => {
  const profilePlan = buildScenarioRequestPlan({
    scenarioId: 'S3',
  })

  const unauthorized = executeScenarioHttpRequest({
    httpClient: createHttpClient({
      response: {
        status: 401,
        body: JSON.stringify({
          error: 'Unauthorized',
        }),
        timings: {
          duration: 8,
        },
      },
    }),
    plan: profilePlan,
    baseUrl: BASE_URL,
    phase: 'measured',
    tokenUser: tokenUser(profilePlan.userSequence, 'R'),
  })

  assert.equal(unauthorized.expected, false)
  assert.equal(unauthorized.category, 'unauthorized')

  const healthPlan = buildScenarioRequestPlan({
    scenarioId: 'S0',
  })

  const malformed = executeScenarioHttpRequest({
    httpClient: createHttpClient({
      response: {
        status: 200,
        body: 'not-json',
        timings: {
          duration: 4,
        },
      },
    }),
    plan: healthPlan,
    baseUrl: BASE_URL,
    phase: 'measured',
  })

  assert.equal(malformed.expected, false)
  assert.equal(malformed.category, 'contract-error')
})

test('converts thrown transport errors into a safe result', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S2',
    metadata,
  })

  const outcome = executeScenarioHttpRequest({
    httpClient: createHttpClient({
      throwRequest: true,
    }),
    plan,
    baseUrl: BASE_URL,
    phase: 'measured',
    tokenUser: tokenUser(plan.userSequence, 'R'),
  })

  assert.equal(outcome.expected, false)
  assert.equal(outcome.category, 'transport-error')
  assert.equal(outcome.status, 0)
  assert.equal(outcome.transportCompleted, false)

  const serializedOutcome = JSON.stringify(outcome)

  assert.equal(serializedOutcome.includes(PRIVATE_ERROR), false)
  assert.equal(serializedOutcome.includes(PRIVATE_TOKEN), false)
  assert.equal(serializedOutcome.includes(PRIVATE_PASSWORD), false)
})

test('rejects unsafe targets, phases, and incomplete clients', () => {
  const plan = buildScenarioRequestPlan({
    scenarioId: 'S0',
  })

  const responseCallback = {
    statuses: [200],
  }

  for (const baseUrl of [
    'http://staging.example.invalid',
    'https://user:password@staging.example.invalid',
    'https://staging.example.invalid/path',
    'https://staging.example.invalid?query=yes',
  ]) {
    assert.throws(
      () =>
        buildScenarioHttpRequest({
          plan,
          baseUrl,
          phase: 'measured',
          responseCallback,
        }),
      /base URL/,
    )
  }

  assert.throws(
    () =>
      buildScenarioHttpRequest({
        plan,
        baseUrl: BASE_URL,
        phase: 'unknown',
        responseCallback,
      }),
    /phase/,
  )

  assert.throws(
    () =>
      executeScenarioHttpRequest({
        httpClient: {
          request() {},
        },
        plan,
        baseUrl: BASE_URL,
        phase: 'measured',
      }),
    /HTTP client is incomplete/,
  )
})

test('rejects mismatched authentication inputs before HTTP access', () => {
  const bearerPlan = buildScenarioRequestPlan({
    scenarioId: 'S2',
    metadata,
  })

  const bearerClient = createHttpClient()

  assert.throws(
    () =>
      executeScenarioHttpRequest({
        httpClient: bearerClient,
        plan: bearerPlan,
        baseUrl: BASE_URL,
        phase: 'measured',
        tokenUser: tokenUser(bearerPlan.userSequence + 1, 'R'),
      }),
    /bearer user does not match/,
  )

  assert.equal(bearerClient.calls.length, 0)

  const loginPlan = buildScenarioRequestPlan({
    scenarioId: 'S1',
    metadata,
  })

  const loginClient = createHttpClient()

  assert.throws(
    () =>
      executeScenarioHttpRequest({
        httpClient: loginClient,
        plan: loginPlan,
        baseUrl: BASE_URL,
        phase: 'measured',
        loginPassword: 'too-short',
      }),
    /login password/,
  )

  assert.equal(loginClient.calls.length, 0)
})

test('k6 runtime adapter exposes one controlled HTTP boundary', async () => {
  const source = await readFile(new URL('./k6/scenario-http-runtime.js', import.meta.url), 'utf8')

  assert.match(source, /from\s+['"]k6\/http['"]/)

  assert.match(source, /executeScenarioHttpRequest\s*\(\s*\{/)

  assert.match(source, /httpClient:\s*http/)

  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /DATABASE_URL/)
  assert.doesNotMatch(source, /JWT_SECRET/)
  assert.doesNotMatch(source, /PERF_LOGIN_PASSWORD/)
})
