import { PERF_LOGIN_PASSWORD_BYTES } from './baseline-config.mjs'

function fail(message) {
  throw new Error(`Invalid PERF login password: ${message}`)
}

export function validatePerfLoginPassword(password) {
  if (typeof password !== 'string') {
    fail('value is missing')
  }

  if (/[\u0000\r\n]/.test(password)) {
    fail('value contains a prohibited control character')
  }

  const utf8Bytes = Buffer.byteLength(password, 'utf8')

  if (utf8Bytes < PERF_LOGIN_PASSWORD_BYTES.minimum) {
    fail(`value must contain at least ${PERF_LOGIN_PASSWORD_BYTES.minimum} UTF-8 bytes`)
  }

  if (utf8Bytes > PERF_LOGIN_PASSWORD_BYTES.maximum) {
    fail(`value must contain at most ${PERF_LOGIN_PASSWORD_BYTES.maximum} UTF-8 bytes`)
  }

  return {
    utf8Bytes,
    minimumBytes: PERF_LOGIN_PASSWORD_BYTES.minimum,
    maximumBytes: PERF_LOGIN_PASSWORD_BYTES.maximum,
    passwordReturned: false,
  }
}

export function requirePerfLoginPassword(environment = process.env) {
  if (environment === null || typeof environment !== 'object') {
    fail('environment is unavailable')
  }

  const password = environment.PERF_LOGIN_PASSWORD

  validatePerfLoginPassword(password)

  return password
}
