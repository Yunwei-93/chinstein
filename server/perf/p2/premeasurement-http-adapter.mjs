import { TextDecoder } from 'node:util'

import { validatePerfLoginPassword } from './login-secret-contract.mjs'
import { normalizeScenarioHttpsOrigin } from './k6/scenario-http-contracts.mjs'

const REQUEST_TIMEOUT_MILLISECONDS = 30_000
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_EMAIL_CHARACTERS = 320
const MAX_TOKEN_CHARACTERS = 4096

const CANARY_KEYS = [
  'canaryId',
  'credentialSource',
  'expectedStatus',
  'method',
  'path',
  'scenarioId',
  'userSequence',
]

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

class P2PremeasurementHttpAdapterError extends Error {}

function fail(message) {
  throw new P2PremeasurementHttpAdapterError(
    `PERF-P2 premeasurement HTTP adapter failed: ${message}`,
  )
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

function createDefaultAbortController() {
  return new AbortController()
}

function validateFactoryDependencies({
  fetchImpl,
  createAbortController,
  setTimeoutImpl,
  clearTimeoutImpl,
}) {
  if (
    typeof fetchImpl !== 'function' ||
    typeof createAbortController !== 'function' ||
    typeof setTimeoutImpl !== 'function' ||
    typeof clearTimeoutImpl !== 'function'
  ) {
    fail('dependencies are incomplete')
  }
}

function validateCanary(canary) {
  if (!hasExactKeys(canary, CANARY_KEYS)) {
    fail('canary definition is invalid')
  }

  const expected = CANARIES[canary.canaryId]

  if (!expected) {
    fail('canary definition is invalid')
  }

  for (const key of CANARY_KEYS) {
    if (canary[key] !== expected[key]) {
      fail('canary definition is invalid')
    }
  }

  return expected
}

function validateEmail(email) {
  if (
    typeof email !== 'string' ||
    email.length === 0 ||
    email.length > MAX_EMAIL_CHARACTERS ||
    /[\u0000\r\n]/.test(email) ||
    !/^[^\s@]+@[^\s@]+$/.test(email)
  ) {
    fail('login credential is invalid')
  }

  return email
}

function validateToken(token) {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_TOKEN_CHARACTERS ||
    /\s/.test(token)
  ) {
    fail('fixture credential is invalid')
  }

  return token
}

function validateCredential(canary, credential) {
  if (canary.canaryId === 'health') {
    if (!hasExactKeys(credential, ['type']) || credential.type !== 'none') {
      fail('health credential is invalid')
    }

    return credential
  }

  if (canary.canaryId === 'login') {
    if (
      !hasExactKeys(credential, ['email', 'password', 'type']) ||
      credential.type !== 'runtime-login-password'
    ) {
      fail('login credential is invalid')
    }

    validateEmail(credential.email)

    try {
      validatePerfLoginPassword(credential.password)
    } catch {
      fail('login credential is invalid')
    }

    return credential
  }

  if (!hasExactKeys(credential, ['token', 'type']) || credential.type !== 'fixture-token') {
    fail('fixture credential is invalid')
  }

  validateToken(credential.token)

  return credential
}

function buildRequest({ baseUrl, canary, credential, signal }) {
  let origin

  try {
    origin = normalizeScenarioHttpsOrigin(baseUrl)
  } catch {
    fail('HTTPS origin is invalid')
  }

  if (origin !== baseUrl) {
    fail('HTTPS origin is invalid')
  }

  const headers = {
    Accept: 'application/json',
  }

  const request = {
    method: canary.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  }

  if (canary.canaryId === 'login') {
    headers['Content-Type'] = 'application/json'
    request.body = JSON.stringify({
      email: credential.email,
      password: credential.password,
    })
  }

  if (canary.canaryId === 'protected') {
    headers.Authorization = `Bearer ${credential.token}`
  }

  return {
    url: `${origin}${canary.path}`,
    request,
  }
}

function validateAbortController(controller) {
  if (
    !isObject(controller) ||
    !isObject(controller.signal) ||
    typeof controller.abort !== 'function'
  ) {
    fail('abort controller is unavailable')
  }

  return controller
}

function readContentLength(response) {
  const rawLength = response?.headers?.get?.('content-length')

  if (rawLength === null || rawLength === undefined) {
    return null
  }

  if (!/^\d+$/.test(rawLength)) {
    fail('response length is invalid')
  }

  const length = Number(rawLength)

  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
    fail('response is too large')
  }

  return length
}

function validateJsonContentType(response) {
  const contentType = response?.headers?.get?.('content-type')

  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    fail('response content type is invalid')
  }
}

async function readBoundedResponseText(response) {
  validateJsonContentType(response)
  readContentLength(response)

  const reader = response?.body?.getReader?.()

  if (!reader || typeof reader.read !== 'function') {
    fail('response body is unavailable')
  }

  const decoder = new TextDecoder('utf-8', {
    fatal: true,
  })

  let bytesRead = 0
  let text = ''

  try {
    while (true) {
      const chunk = await reader.read()

      if (!isObject(chunk) || typeof chunk.done !== 'boolean') {
        fail('response body is invalid')
      }

      if (chunk.done) {
        break
      }

      if (!(chunk.value instanceof Uint8Array)) {
        fail('response body is invalid')
      }

      bytesRead += chunk.value.byteLength

      if (bytesRead > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {}

        fail('response is too large')
      }

      text += decoder.decode(chunk.value, {
        stream: true,
      })
    }

    text += decoder.decode()
  } catch (error) {
    if (error instanceof P2PremeasurementHttpAdapterError) {
      throw error
    }

    fail('response body is invalid')
  } finally {
    try {
      reader.releaseLock?.()
    } catch {}
  }

  return text
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isStrictUtcTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false
  }

  const milliseconds = Date.parse(value)

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().startsWith(value.slice(0, 19))
  )
}

function projectHealthBody(body) {
  if (!isObject(body) || body.status !== 'ok' || !isStrictUtcTimestamp(body.time)) {
    fail('health response is invalid')
  }

  return {
    status: 'ok',
    time: body.time,
  }
}

function projectLoginBody(body) {
  if (
    !isObject(body) ||
    typeof body.token !== 'string' ||
    body.token.length === 0 ||
    !isObject(body.user) ||
    !isPositiveInteger(body.user.id) ||
    typeof body.user.name !== 'string' ||
    body.user.name.length === 0
  ) {
    fail('login response is invalid')
  }

  return {
    token: 'present',
    user: {
      id: body.user.id,
      name: 'present',
    },
  }
}

function projectProtectedBody(body) {
  if (
    !isObject(body) ||
    !isPositiveInteger(body.id) ||
    typeof body.name !== 'string' ||
    body.name.length === 0 ||
    !Number.isFinite(body.points) ||
    !Number.isSafeInteger(body.streak) ||
    body.streak < 0 ||
    !Array.isArray(body.badges) ||
    !Array.isArray(body.learnedCharacterIds) ||
    typeof body.completedToday !== 'boolean'
  ) {
    fail('protected response is invalid')
  }

  return {
    id: body.id,
    name: 'present',
    points: 0,
    streak: 0,
    badges: [],
    learnedCharacterIds: [],
    completedToday: false,
  }
}

function projectBody(canaryId, body) {
  if (canaryId === 'health') {
    return projectHealthBody(body)
  }

  if (canaryId === 'login') {
    return projectLoginBody(body)
  }

  return projectProtectedBody(body)
}

async function readSuccessfulBody(response, canaryId) {
  const text = await readBoundedResponseText(response)
  let body

  try {
    body = JSON.parse(text)
  } catch {
    fail('response JSON is invalid')
  }

  return projectBody(canaryId, body)
}

export function createP2PremeasurementHttpAdapter({
  fetchImpl = globalThis.fetch,
  createAbortController = createDefaultAbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  validateFactoryDependencies({
    fetchImpl,
    createAbortController,
    setTimeoutImpl,
    clearTimeoutImpl,
  })

  return Object.freeze({
    async executeCanary(input) {
      if (!hasExactKeys(input, ['baseUrl', 'canary', 'credential'])) {
        fail('request input is invalid')
      }

      const canary = validateCanary(input.canary)
      const credential = validateCredential(canary, input.credential)

      let controller

      try {
        controller = validateAbortController(createAbortController())
      } catch {
        fail('abort controller is unavailable')
      }

      const { url, request } = buildRequest({
        baseUrl: input.baseUrl,
        canary,
        credential,
        signal: controller.signal,
      })

      let timeoutId

      try {
        timeoutId = setTimeoutImpl(() => {
          try {
            controller.abort()
          } catch {}
        }, REQUEST_TIMEOUT_MILLISECONDS)
      } catch {
        fail('request timeout is unavailable')
      }

      try {
        let response

        try {
          response = await fetchImpl(url, request)
        } catch {
          return {
            status: 0,
            body: null,
          }
        }

        if (
          !isObject(response) ||
          !Number.isSafeInteger(response.status) ||
          response.status < 100 ||
          response.status > 599
        ) {
          return {
            status: 0,
            body: null,
          }
        }

        if (response.status !== 200) {
          return {
            status: response.status,
            body: null,
          }
        }

        return {
          status: response.status,
          body: await readSuccessfulBody(response, canary.canaryId),
        }
      } finally {
        try {
          clearTimeoutImpl(timeoutId)
        } catch {
          fail('request timeout cleanup failed')
        }
      }
    },
  })
}
