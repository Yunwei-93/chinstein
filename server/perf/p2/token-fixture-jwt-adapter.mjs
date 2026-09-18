import jwt from 'jsonwebtoken'

import { signToken as signApplicationToken } from '../../dist/auth.js'

import { TOKEN_TTL_SECONDS } from './token-fixture-contracts.mjs'

const TOKEN_ALGORITHM = 'HS256'
const TOKEN_EXPIRES_IN = '4h'
const MINIMUM_SECRET_BYTES = 32

function fail(message) {
  throw new Error(`Unable to use PERF JWT adapter: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function captureEnvironmentValue(environment, key) {
  return {
    present: hasOwn(environment, key),
    value: environment[key],
  }
}

function restoreEnvironmentValue(environment, key, snapshot) {
  if (snapshot.present) {
    environment[key] = snapshot.value
    return
  }

  delete environment[key]
}

function runWithApplicationJwtEnvironment(secret, operation) {
  const environment = process.env

  const previousSecret = captureEnvironmentValue(environment, 'JWT_SECRET')

  const previousExpiresIn = captureEnvironmentValue(environment, 'JWT_EXPIRES_IN')

  try {
    environment.JWT_SECRET = secret
    environment.JWT_EXPIRES_IN = TOKEN_EXPIRES_IN

    return operation()
  } finally {
    try {
      restoreEnvironmentValue(environment, 'JWT_EXPIRES_IN', previousExpiresIn)
    } finally {
      restoreEnvironmentValue(environment, 'JWT_SECRET', previousSecret)
    }
  }
}

function readApplicationSecret() {
  const secret = process.env.JWT_SECRET

  if (typeof secret !== 'string' || secret.trim().length === 0 || /[\u0000\r\n]/.test(secret)) {
    fail('JWT_SECRET is unavailable or invalid')
  }

  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    fail('JWT_SECRET is shorter than 32 UTF-8 bytes')
  }

  return secret
}

function sanitizeVerifiedToken(verified) {
  if (!isObject(verified) || !isObject(verified.header) || !isObject(verified.payload)) {
    fail('verified token has an invalid structure')
  }

  if (verified.header.alg !== TOKEN_ALGORITHM) {
    fail('verified token does not use HS256')
  }

  if (!isPositiveSafeInteger(verified.payload.userId)) {
    fail('verified token has an invalid user ID')
  }

  if (!Number.isInteger(verified.payload.iat) || !Number.isInteger(verified.payload.exp)) {
    fail('verified token has invalid timestamps')
  }

  if (verified.payload.exp - verified.payload.iat !== TOKEN_TTL_SECONDS) {
    fail('verified token is not valid for four hours')
  }

  // Return only the fields required by the fixture builder.
  return {
    header: {
      alg: TOKEN_ALGORITHM,
    },
    payload: {
      userId: verified.payload.userId,
      iat: verified.payload.iat,
      exp: verified.payload.exp,
    },
  }
}

export function createTokenFixtureJwtAdapter() {
  const secret = readApplicationSecret()

  function signTokenForUser(userId) {
    if (!isPositiveSafeInteger(userId)) {
      fail('user ID must be a positive safe integer')
    }

    let token

    try {
      // Scope the four-hour lifetime to this application signing call.
      token = runWithApplicationJwtEnvironment(secret, () => signApplicationToken(userId))
    } catch {
      fail('application token signing failed')
    }

    if (typeof token !== 'string' || token.length === 0) {
      fail('application token signing returned no token')
    }

    return token
  }

  function verifySignedToken(token) {
    if (typeof token !== 'string' || token.length === 0) {
      fail('signed token is missing')
    }

    let verified

    try {
      verified = jwt.verify(token, secret, {
        algorithms: [TOKEN_ALGORITHM],
        complete: true,
      })
    } catch {
      fail('signed token failed cryptographic verification')
    }

    return sanitizeVerifiedToken(verified)
  }

  return Object.freeze({
    signTokenForUser,
    verifySignedToken,
  })
}
