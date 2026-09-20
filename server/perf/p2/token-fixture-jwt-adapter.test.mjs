import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import jwt from 'jsonwebtoken'

import { TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'
import { createTokenFixtureJwtAdapter } from './token-fixture-jwt-adapter.mjs'

const TEST_SECRET = 'offline-only-jwt-secret-material-'.repeat(2)

const JWT_ENVIRONMENT_KEYS = ['JWT_SECRET', 'JWT_EXPIRES_IN']

function captureJwtEnvironment() {
  return new Map(
    JWT_ENVIRONMENT_KEYS.map((key) => [
      key,
      {
        present: Object.hasOwn(process.env, key),
        value: process.env[key],
      },
    ]),
  )
}

function restoreJwtEnvironment(snapshot) {
  for (const key of JWT_ENVIRONMENT_KEYS) {
    const previous = snapshot.get(key)

    if (previous.present) {
      process.env[key] = previous.value
    } else {
      delete process.env[key]
    }
  }
}

function withTestJwtEnvironment(values, operation) {
  const snapshot = captureJwtEnvironment()

  try {
    for (const key of JWT_ENVIRONMENT_KEYS) {
      const value = values[key]

      if (value === null || value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    return operation()
  } finally {
    restoreJwtEnvironment(snapshot)
  }
}

test('uses the real application signer with HS256 and an exact four-hour TTL', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: '91m',
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const restoredSecret = 'restore-this-secret-after-signing'

      const restoredExpiresIn = '17m'

      process.env.JWT_SECRET = restoredSecret
      process.env.JWT_EXPIRES_IN = restoredExpiresIn

      const token = adapter.signTokenForUser(10_001)

      assert.equal(process.env.JWT_SECRET, restoredSecret)

      assert.equal(process.env.JWT_EXPIRES_IN, restoredExpiresIn)

      const verified = adapter.verifySignedToken(token)

      assert.deepEqual(verified.header, {
        alg: 'HS256',
      })

      assert.equal(verified.payload.userId, 10_001)

      assert.equal(verified.payload.exp - verified.payload.iat, TOKEN_TTL_SECONDS)

      assert.deepEqual(Object.keys(verified).sort(), ['header', 'payload'])

      assert.deepEqual(Object.keys(verified.payload).sort(), ['exp', 'iat', 'userId'])

      const serializedVerification = JSON.stringify(verified)

      assert.equal(serializedVerification.includes(token), false)

      assert.equal(serializedVerification.includes(TEST_SECRET), false)
    },
  )
})

test('restores an originally absent JWT_EXPIRES_IN value', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      adapter.signTokenForUser(10_002)

      assert.equal(Object.hasOwn(process.env, 'JWT_EXPIRES_IN'), false)

      assert.equal(process.env.JWT_SECRET, TEST_SECRET)
    },
  )
})

test('rejects invalid user IDs before signing', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const invalidUserIds = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '10001', null]

      for (const userId of invalidUserIds) {
        assert.throws(() => adapter.signTokenForUser(userId), /positive safe integer/)
      }
    },
  )
})

test('rejects a missing, invalid, or short application JWT secret', () => {
  const cases = [
    {
      secret: null,
      expectedError: /JWT_SECRET is unavailable or invalid/,
    },
    {
      secret: '',
      expectedError: /JWT_SECRET is unavailable or invalid/,
    },
    {
      secret: '   ',
      expectedError: /JWT_SECRET is unavailable or invalid/,
    },
    {
      secret: '\n',
      expectedError: /JWT_SECRET is unavailable or invalid/,
    },
    {
      secret: 'short-secret',
      expectedError: /JWT_SECRET is shorter than 32 UTF-8 bytes/,
    },
  ]

  for (const testCase of cases) {
    withTestJwtEnvironment(
      {
        JWT_SECRET: testCase.secret,
        JWT_EXPIRES_IN: null,
      },
      () => {
        assert.throws(() => createTokenFixtureJwtAdapter(), testCase.expectedError)
      },
    )
  }
})

test('rejects tokens signed with another algorithm or secret', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const wrongAlgorithmToken = jwt.sign(
        {
          userId: 10_001,
        },
        TEST_SECRET,
        {
          algorithm: 'HS384',
          expiresIn: '4h',
        },
      )

      const wrongSecretToken = jwt.sign(
        {
          userId: 10_001,
        },
        'different-offline-secret-material'.repeat(2),
        {
          algorithm: 'HS256',
          expiresIn: '4h',
        },
      )

      for (const token of [wrongAlgorithmToken, wrongSecretToken]) {
        assert.throws(() => adapter.verifySignedToken(token), /failed cryptographic verification/)
      }
    },
  )
})

test('rejects a token whose signature was modified', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const token = adapter.signTokenForUser(10_001)
      const parts = token.split('.')

      const firstSignatureCharacter = parts[2][0]

      const replacementCharacter = firstSignatureCharacter === 'a' ? 'b' : 'a'

      parts[2] = replacementCharacter + parts[2].slice(1)

      const modifiedToken = parts.join('.')

      assert.throws(
        () => adapter.verifySignedToken(modifiedToken),
        /failed cryptographic verification/,
      )
    },
  )
})

test('rejects a cryptographically valid token with an invalid user ID', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const token = jwt.sign(
        {
          userId: '10001',
        },
        TEST_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: '4h',
        },
      )

      assert.throws(() => adapter.verifySignedToken(token), /invalid user ID/)
    },
  )
})

test('rejects a cryptographically valid token with the wrong TTL', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const token = jwt.sign(
        {
          userId: 10_001,
        },
        TEST_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: '1h',
        },
      )

      assert.throws(() => adapter.verifySignedToken(token), /not valid for four hours/)
    },
  )
})

test('rejects an expired token', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const token = jwt.sign(
        {
          userId: 10_001,
        },
        TEST_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: -1,
        },
      )

      assert.throws(() => adapter.verifySignedToken(token), /failed cryptographic verification/)
    },
  )
})

test('verification errors never contain the token or JWT secret', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      const privateTokenMarker = 'private-invalid-token-marker'

      assert.throws(
        () => adapter.verifySignedToken(privateTokenMarker),
        (error) => {
          assert.equal(
            error.message,
            'Unable to use PERF JWT adapter: signed token failed cryptographic verification',
          )

          assert.equal(error.message.includes(privateTokenMarker), false)

          assert.equal(error.message.includes(TEST_SECRET), false)

          return true
        },
      )
    },
  )
})

test('adapter public surface exposes no secret or token values', () => {
  withTestJwtEnvironment(
    {
      JWT_SECRET: TEST_SECRET,
      JWT_EXPIRES_IN: null,
    },
    () => {
      const adapter = createTokenFixtureJwtAdapter()

      assert.deepEqual(Object.keys(adapter).sort(), ['signTokenForUser', 'verifySignedToken'])

      assert.equal(JSON.stringify(adapter).includes(TEST_SECRET), false)
    },
  )
})

test('implementation uses verify rather than decode and has no logging path', async () => {
  const source = await readFile(new URL('./token-fixture-jwt-adapter.mjs', import.meta.url), 'utf8')

  assert.match(source, /jwt\.verify\s*\(/)

  assert.doesNotMatch(source, /jwt\.decode\s*\(/)

  assert.doesNotMatch(source, /\bconsole\./)
})
