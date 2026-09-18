import { POOLS } from '../fixture-config.mjs'

export const P2_LEVELS = Object.freeze([1, 5])
export const P2_REPETITIONS = 3

export const P2_TIMED_WORKLOAD = Object.freeze({
  warmupSeconds: 30,
  measuredSeconds: 60,
})

export const P2_WRITE_WORKLOAD = Object.freeze({
  warmupIterations: 5,
  measuredIterations: 50,
})

export const PERF_LOGIN_PASSWORD_BYTES = Object.freeze({
  minimum: 32,
  maximum: 72,
})

function freezeRange(firstSeq, lastSeq) {
  return Object.freeze({
    firstSeq,
    lastSeq,
    users: lastSeq - firstSeq + 1,
  })
}

export const POOL_A_ALLOCATIONS = Object.freeze({
  baselineIsolated: freezeRange(901, 3900),
  comparisonIsolated: freezeRange(3901, 6900),
  baselineMixed: freezeRange(6901, 7100),
  comparisonMixed: freezeRange(7101, 7300),
  operationalReserve: freezeRange(7301, 7900),
  p2WriteReserve: freezeRange(7301, 7630),
  unusedReserve: freezeRange(7631, 7900),
})

export const BASELINE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'S0',
    name: 'health',
    method: 'GET',
    path: '/api/health',
    pool: null,
    authentication: 'none',
    workload: 'timed',
    expectedStatus: 200,
    responseContract: 'health',
  }),
  Object.freeze({
    id: 'S1',
    name: 'login',
    method: 'POST',
    path: '/api/auth/login',
    pool: 'R',
    userSeq: POOLS.R.firstSeq,
    authentication: 'credentials',
    workload: 'timed',
    expectedStatus: 200,
    responseContract: 'login',
  }),
  Object.freeze({
    id: 'S2',
    name: 'today-character',
    method: 'GET',
    path: '/api/characters/today',
    pool: 'R',
    authentication: 'bearer',
    workload: 'timed',
    expectedStatus: 200,
    responseContract: 'today-character',
  }),
  Object.freeze({
    id: 'S3',
    name: 'current-user',
    method: 'GET',
    path: '/api/me',
    pool: 'R',
    authentication: 'bearer',
    workload: 'timed',
    expectedStatus: 200,
    responseContract: 'current-user',
  }),
  Object.freeze({
    id: 'S4',
    name: 'leaderboard',
    method: 'GET',
    path: '/api/leaderboard',
    pool: 'R',
    authentication: 'bearer',
    workload: 'timed',
    expectedStatus: 200,
    responseContract: 'leaderboard',
  }),
  Object.freeze({
    id: 'S5',
    name: 'first-session-write',
    method: 'POST',
    path: '/api/sessions',
    pool: 'A',
    authentication: 'bearer',
    workload: 'finite-write',
    expectedStatus: 201,
    responseContract: 'created-session',
    userRange: POOL_A_ALLOCATIONS.p2WriteReserve,
  }),
  Object.freeze({
    id: 'S6',
    name: 'existing-session-conflict',
    method: 'POST',
    path: '/api/sessions',
    pool: 'B',
    authentication: 'bearer',
    workload: 'timed',
    expectedStatus: 409,
    expectedCode: 'ALREADY_STUDIED_TODAY',
    responseContract: 'existing-session-conflict',
  }),
])
