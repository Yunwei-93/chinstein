import assert from 'node:assert/strict'
import test from 'node:test'

import { requirePerfLoginPassword, validatePerfLoginPassword } from './login-secret-contract.mjs'

test('accepts a password at the 32-byte minimum', () => {
  const summary = validatePerfLoginPassword('a'.repeat(32))

  assert.equal(summary.utf8Bytes, 32)
  assert.equal(summary.minimumBytes, 32)
  assert.equal(summary.maximumBytes, 72)
  assert.equal(summary.passwordReturned, false)
})

test('accepts a password at the 72-byte maximum', () => {
  const summary = validatePerfLoginPassword('a'.repeat(72))

  assert.equal(summary.utf8Bytes, 72)
})

test('measures password length using UTF-8 bytes', () => {
  const summary = validatePerfLoginPassword('界'.repeat(11))

  assert.equal(summary.utf8Bytes, 33)
})

test('rejects a password below the minimum', () => {
  assert.throws(() => validatePerfLoginPassword('a'.repeat(31)), /at least 32 UTF-8 bytes/)
})

test('rejects a password above the maximum', () => {
  assert.throws(() => validatePerfLoginPassword('a'.repeat(73)), /at most 72 UTF-8 bytes/)
})

test('rejects prohibited control characters', () => {
  const invalidPasswords = [`${'a'.repeat(32)}\u0000`, `${'a'.repeat(32)}\r`, `${'a'.repeat(32)}\n`]

  for (const password of invalidPasswords) {
    assert.throws(() => validatePerfLoginPassword(password), /prohibited control character/)
  }
})

test('rejects missing and non-string password values', () => {
  assert.throws(() => validatePerfLoginPassword(undefined), /value is missing/)

  assert.throws(() => validatePerfLoginPassword(123), /value is missing/)
})

test('rejects an unavailable environment', () => {
  assert.throws(() => requirePerfLoginPassword(null), /environment is unavailable/)

  assert.throws(() => requirePerfLoginPassword({}), /value is missing/)
})

test('returns the validated password to its direct caller', () => {
  const password = 'private-value-'.repeat(3)

  assert.equal(
    requirePerfLoginPassword({
      PERF_LOGIN_PASSWORD: password,
    }),
    password,
  )
})

test('validation summaries never contain the password', () => {
  const password = 'private-value-'.repeat(3)
  const summary = validatePerfLoginPassword(password)

  assert.equal(summary.passwordReturned, false)
  assert.equal(JSON.stringify(summary).includes(password), false)
})
