import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyScenarioResponse } from './response-contracts.mjs'
import * as httpAdapterModule from './premeasurement-http-adapter.mjs'

const { createP2PremeasurementHttpAdapter } = httpAdapterModule

const BASE_URL = 'https://staging.example.invalid'
const USER_ID = 10_001
const PRIVATE_EMAIL = 'player_00001@example.invalid'
const PRIVATE_PASSWORD = 'private-login-password-value-000001'
const PRIVATE_FIXTURE_TOKEN = 'private.fixture.token'
const PRIVATE_LOGIN_TOKEN = 'private.login.response.token'
const PRIVATE_NAME = 'private-player-name'
const PRIVATE_RAW_ERROR = `${PRIVATE_PASSWORD}:${PRIVATE_FIXTURE_TOKEN}:${PRIVATE_EMAIL}`

const CANARIES = Object.freeze({
  health: Object.freeze({
    canaryId: 'health',
    scenarioId: 'S0',
    method: 'GET',
    path: '/api/health',
    credentialSource: 'none',
    userSequence: null,
    expectedStatus: 200,
  }),
  login: Object.freeze({
    canaryId: 'login',
    scenarioId: 'S1',
    method: 'POST',
    path: '/api/auth/login',
    credentialSource: 'runtime-login-password',
    userSequence: 1,
    expectedStatus: 200,
  }),
  protected: Object.freeze({
    canaryId: 'protected',
    scenarioId: 'S3',
    method: 'GET',
    path: '/api/me',
    credentialSource: 'fixture-token',
    userSequence: 1,
    expectedStatus: 200,
  }),
})

const CREDENTIALS = Object.freeze({
  health: Object.freeze({
    type: 'none',
  }),
  login: Object.freeze({
    type: 'runtime-login-password',
    email: PRIVATE_EMAIL,
    password: PRIVATE_PASSWORD,
  }),
  protected: Object.freeze({
    type: 'fixture-token',
    token: PRIVATE_FIXTURE_TOKEN,
  }),
})

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const serialized = JSON.stringify(body)

  return new Response(serialized, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(serialized, 'utf8')),
      ...headers,
    },
  })
}

function createResponse(canaryId) {
  if (canaryId === 'health') {
    return jsonResponse({
      status: 'ok',
      time: '2026-09-18T12:00:00.000Z',
      ignored: PRIVATE_RAW_ERROR,
    })
  }

  if (canaryId === 'login') {
    return jsonResponse({
      token: PRIVATE_LOGIN_TOKEN,
      user: {
        id: USER_ID,
        name: PRIVATE_NAME,
      },
      ignored: PRIVATE_RAW_ERROR,
    })
  }

  return jsonResponse({
    id: USER_ID,
    name: PRIVATE_NAME,
    points: 99,
    streak: 7,
    badges: ['private-badge'],
    learnedCharacterIds: [1, 2, 3],
    completedToday: true,
    ignored: PRIVATE_RAW_ERROR,
  })
}

function createHarness(fetchImplementation = null) {
  const requests = []
  const timers = []
  const clearedTimers = []
  let nextTimerId = 1

  const fetchImpl = async (url, request) => {
    requests.push({ url, request })

    if (fetchImplementation) {
      return fetchImplementation(url, request)
    }

    const canaryId = url.endsWith('/api/health')
      ? 'health'
      : url.endsWith('/api/auth/login')
        ? 'login'
        : 'protected'

    return createResponse(canaryId)
  }

  const adapter = createP2PremeasurementHttpAdapter({
    fetchImpl,
    createAbortController: () => new AbortController(),
    setTimeoutImpl(callback, milliseconds) {
      const id = nextTimerId
      nextTimerId += 1
      timers.push({ id, callback, milliseconds })
      return id
    },
    clearTimeoutImpl(id) {
      clearedTimers.push(id)
    },
  })

  return {
    adapter,
    requests,
    timers,
    clearedTimers,
  }
}

function createInput(canaryId) {
  return {
    baseUrl: BASE_URL,
    canary: CANARIES[canaryId],
    credential: CREDENTIALS[canaryId],
  }
}

async function captureFailure(operation) {
  try {
    await operation()
  } catch (error) {
    return error
  }

  assert.fail('Expected the operation to fail')
}

test('exports only the approved HTTP adapter factory and execution surface', () => {
  assert.deepEqual(Object.keys(httpAdapterModule), ['createP2PremeasurementHttpAdapter'])

  const harness = createHarness()

  assert.deepEqual(Object.keys(harness.adapter), ['executeCanary'])
  assert.equal(Object.isFrozen(harness.adapter), true)
})

test('executes one bounded health request without credentials', async () => {
  const harness = createHarness()
  const result = await harness.adapter.executeCanary(createInput('health'))

  assert.deepEqual(result, {
    status: 200,
    body: {
      status: 'ok',
      time: '2026-09-18T12:00:00.000Z',
    },
  })

  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].url, `${BASE_URL}/api/health`)
  assert.deepEqual(harness.requests[0].request.headers, {
    Accept: 'application/json',
  })
  assert.equal(harness.requests[0].request.method, 'GET')
  assert.equal('body' in harness.requests[0].request, false)
  assert.equal(harness.requests[0].request.redirect, 'manual')
  assert.equal(harness.requests[0].request.cache, 'no-store')
  assert.equal(harness.requests[0].request.credentials, 'omit')
  assert.equal(harness.requests[0].request.referrerPolicy, 'no-referrer')
  assert.equal(harness.timers[0].milliseconds, 30_000)
  assert.deepEqual(harness.clearedTimers, [harness.timers[0].id])
})

test('injects login credentials only into the login request and redacts its token', async () => {
  const harness = createHarness()
  const result = await harness.adapter.executeCanary(createInput('login'))

  assert.deepEqual(result, {
    status: 200,
    body: {
      token: 'present',
      user: {
        id: USER_ID,
        name: 'present',
      },
    },
  })

  assert.equal(harness.requests[0].url, `${BASE_URL}/api/auth/login`)
  assert.equal(harness.requests[0].request.method, 'POST')
  assert.deepEqual(harness.requests[0].request.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
  assert.deepEqual(JSON.parse(harness.requests[0].request.body), {
    email: PRIVATE_EMAIL,
    password: PRIVATE_PASSWORD,
  })

  const serializedResult = JSON.stringify(result)

  for (const privateValue of [PRIVATE_LOGIN_TOKEN, PRIVATE_NAME, PRIVATE_EMAIL, PRIVATE_PASSWORD]) {
    assert.equal(serializedResult.includes(privateValue), false)
  }
})

test('injects only the fixture token into the protected request and projects its body', async () => {
  const harness = createHarness()
  const result = await harness.adapter.executeCanary(createInput('protected'))

  assert.deepEqual(result, {
    status: 200,
    body: {
      id: USER_ID,
      name: 'present',
      points: 0,
      streak: 0,
      badges: [],
      learnedCharacterIds: [],
      completedToday: false,
    },
  })

  assert.equal(harness.requests[0].url, `${BASE_URL}/api/me`)
  assert.deepEqual(harness.requests[0].request.headers, {
    Accept: 'application/json',
    Authorization: `Bearer ${PRIVATE_FIXTURE_TOKEN}`,
  })
  assert.equal('body' in harness.requests[0].request, false)

  const serializedResult = JSON.stringify(result)

  for (const privateValue of [PRIVATE_FIXTURE_TOKEN, PRIVATE_NAME, 'private-badge']) {
    assert.equal(serializedResult.includes(privateValue), false)
  }
})

test('projected success bodies still satisfy the existing response contracts', async () => {
  const harness = createHarness()
  const cases = [
    ['health', 'S0'],
    ['login', 'S1'],
    ['protected', 'S3'],
  ]

  for (const [canaryId, scenarioId] of cases) {
    const result = await harness.adapter.executeCanary(createInput(canaryId))
    const classification = classifyScenarioResponse({
      scenarioId,
      status: result.status,
      body: result.body,
    })

    assert.equal(classification.expected, true)
  }
})

test('returns a protected 401 without reading or returning its raw response body', async () => {
  let bodyRead = false

  const harness = createHarness(async () => ({
    status: 401,
    headers: {
      get() {
        throw new Error(PRIVATE_RAW_ERROR)
      },
    },
    get body() {
      bodyRead = true
      throw new Error(PRIVATE_RAW_ERROR)
    },
  }))

  const result = await harness.adapter.executeCanary(createInput('protected'))

  assert.deepEqual(result, {
    status: 401,
    body: null,
  })
  assert.equal(bodyRead, false)
  assert.equal(JSON.stringify(result).includes(PRIVATE_RAW_ERROR), false)
})

test('converts transport failures and aborts into status zero without retry', async () => {
  const thrown = createHarness(async () => {
    throw new Error(PRIVATE_RAW_ERROR)
  })

  assert.deepEqual(await thrown.adapter.executeCanary(createInput('health')), {
    status: 0,
    body: null,
  })
  assert.equal(thrown.requests.length, 1)

  const aborted = createHarness(async (_url, request) => {
    aborted.timers[0].callback()

    assert.equal(request.signal.aborted, true)
    throw new Error(PRIVATE_RAW_ERROR)
  })

  assert.deepEqual(await aborted.adapter.executeCanary(createInput('health')), {
    status: 0,
    body: null,
  })
  assert.equal(aborted.requests.length, 1)
})

test('rejects altered canaries, origins, and credential shapes before transport', async () => {
  const cases = [
    {
      ...createInput('health'),
      baseUrl: 'http://staging.example.invalid',
    },
    {
      ...createInput('health'),
      canary: {
        ...CANARIES.health,
        path: '/api/me',
      },
    },
    {
      ...createInput('health'),
      unexpected: PRIVATE_RAW_ERROR,
    },
    {
      ...createInput('login'),
      credential: CREDENTIALS.protected,
    },
    {
      ...createInput('login'),
      credential: {
        ...CREDENTIALS.login,
        password: 'too-short',
      },
    },
    {
      ...createInput('protected'),
      credential: {
        type: 'fixture-token',
        token: 'x'.repeat(4097),
      },
    },
  ]

  for (const input of cases) {
    const harness = createHarness()

    await assert.rejects(harness.adapter.executeCanary(input), /HTTP adapter failed/)
    assert.equal(harness.requests.length, 0)
  }
})

test('fails closed on malformed, non-JSON, or invalid successful responses', async () => {
  const cases = [
    () =>
      new Response('{"status":"ok"', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    () =>
      new Response(JSON.stringify({ status: 'ok', time: 'not-a-time' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    () =>
      new Response(JSON.stringify({ status: 'ok', time: '2026-09-18T12:00:00.000Z' }), {
        status: 200,
        headers: {
          'content-type': 'text/plain',
        },
      }),
    () =>
      new Response(new Uint8Array([0xff]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
  ]

  for (const createInvalidResponse of cases) {
    const harness = createHarness(async () => createInvalidResponse())
    const error = await captureFailure(() => harness.adapter.executeCanary(createInput('health')))

    assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
    assert.equal(harness.requests.length, 1)
  }
})

test('rejects declared and streamed response bodies above the fixed byte limit', async () => {
  const declared = createHarness(async () =>
    jsonResponse(
      {
        status: 'ok',
        time: '2026-09-18T12:00:00.000Z',
      },
      {
        headers: {
          'content-length': String(64 * 1024 + 1),
        },
      },
    ),
  )

  await assert.rejects(
    declared.adapter.executeCanary(createInput('health')),
    /response is too large/,
  )

  const streamed = createHarness(
    async () =>
      new Response(`"${'x'.repeat(64 * 1024)}"`, {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
  )

  await assert.rejects(
    streamed.adapter.executeCanary(createInput('health')),
    /response is too large/,
  )
})

test('sanitizes reader errors that imitate the internal adapter error prefix', async () => {
  const hostileMessage = `PERF-P2 premeasurement HTTP adapter ${PRIVATE_RAW_ERROR}`
  const harness = createHarness(async () => ({
    status: 200,
    headers: {
      get(name) {
        if (name === 'content-type') {
          return 'application/json'
        }

        return null
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            throw new Error(hostileMessage)
          },
          releaseLock() {},
        }
      },
    },
  }))

  const error = await captureFailure(() => harness.adapter.executeCanary(createInput('health')))

  assert.equal(
    error.message,
    'PERF-P2 premeasurement HTTP adapter failed: response body is invalid',
  )
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
})

test('factory and cleanup failures expose only fixed safe messages', async () => {
  assert.throws(
    () =>
      createP2PremeasurementHttpAdapter({
        fetchImpl: null,
      }),
    /dependencies are incomplete/,
  )

  const adapter = createP2PremeasurementHttpAdapter({
    fetchImpl: async () => createResponse('health'),
    createAbortController() {
      throw new Error(PRIVATE_RAW_ERROR)
    },
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: clearTimeout,
  })

  const error = await captureFailure(() => adapter.executeCanary(createInput('health')))

  assert.equal(
    error.message,
    'PERF-P2 premeasurement HTTP adapter failed: abort controller is unavailable',
  )
  assert.equal(error.message.includes(PRIVATE_RAW_ERROR), false)
})
