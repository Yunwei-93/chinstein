import { validatePerfLoginPassword } from './login-secret-contract.mjs'
import {
  assertP2PreCanaryReady,
  assertP2PremeasurementReady,
  buildP2PremeasurementCanaryPlan,
  classifyP2PremeasurementCanary,
} from './premeasurement-contracts.mjs'

const OPTION_KEYS = ['approvedTarget', 'baseUrl']

const DEPENDENCY_KEYS = [
  'executeCanary',
  'loadFixtureEvidence',
  'nowSeconds',
  'observeDeployment',
  'readDatabaseEvidence',
  'readLoginPassword',
]

const FIXTURE_EVIDENCE_KEYS = ['designatedUser', 'fixtureMetadata']

const DEPLOYMENT_EVIDENCE_KEYS = [
  'deploymentStatus',
  'desiredCount',
  'gitCommit',
  'imageDigest',
  'originFingerprint',
  'pendingCount',
  'region',
  'runningCount',
  'service',
  'stage',
  'taskDefinitionRevision',
]

const DATABASE_EVIDENCE_KEYS = [
  'connectionClosed',
  'database',
  'databaseCurrentDate',
  'databaseHostFingerprint',
]

const RESPONSE_KEYS = ['body', 'status']

function fail(stage) {
  throw new Error(`PERF-P2 premeasurement runner failed at ${stage}`)
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

function validateInputs(options, dependencies) {
  if (!hasExactKeys(options, OPTION_KEYS)) {
    fail('validate-options')
  }

  if (!hasExactKeys(dependencies, DEPENDENCY_KEYS)) {
    fail('validate-dependencies')
  }

  for (const dependency of DEPENDENCY_KEYS) {
    if (typeof dependencies[dependency] !== 'function') {
      fail('validate-dependencies')
    }
  }
}

async function runStage(stage, operation) {
  try {
    return await operation()
  } catch {
    fail(stage)
  }
}

function validateFixtureEvidence(evidence) {
  if (!hasExactKeys(evidence, FIXTURE_EVIDENCE_KEYS)) {
    fail('load-fixture')
  }

  return evidence
}

function buildObservedTarget(deploymentEvidence, databaseEvidence) {
  if (!hasExactKeys(deploymentEvidence, DEPLOYMENT_EVIDENCE_KEYS)) {
    fail('observe-deployment')
  }

  if (
    !hasExactKeys(databaseEvidence, DATABASE_EVIDENCE_KEYS) ||
    databaseEvidence.connectionClosed !== true
  ) {
    fail('read-database')
  }

  return {
    ...deploymentEvidence,
    database: databaseEvidence.database,
    databaseHostFingerprint: databaseEvidence.databaseHostFingerprint,
  }
}

function validateCanaryResponse(response, stage) {
  if (!hasExactKeys(response, RESPONSE_KEYS)) {
    fail(stage)
  }

  return response
}

function requirePassedCanary(result, stage) {
  if (result.fixtureInvalidated === true) {
    fail('fixture-invalidated')
  }

  if (result.passed !== true || result.category !== 'expected' || result.status !== 200) {
    fail(stage)
  }

  return result
}

async function readClock(nowSeconds, stage) {
  return runStage(stage, () => nowSeconds())
}

function assertPreCanaryReady({
  approvedTarget,
  observedTarget,
  fixtureMetadata,
  designatedUser,
  nowSeconds,
  databaseCurrentDate,
}) {
  try {
    return assertP2PreCanaryReady({
      approvedTarget,
      observedTarget,
      fixtureMetadata,
      designatedUser,
      nowSeconds,
      databaseCurrentDate,
    })
  } catch {
    fail('pre-canary-gate')
  }
}

async function executeAndClassifyCanary({
  stage,
  executeCanary,
  baseUrl,
  canary,
  credential,
  expectedUserId,
  expectedDate,
  originFingerprint,
}) {
  const response = validateCanaryResponse(
    await runStage(stage, () =>
      executeCanary({
        baseUrl,
        canary,
        credential,
      }),
    ),
    stage,
  )

  let classification

  try {
    classification = classifyP2PremeasurementCanary({
      canaryId: canary.canaryId,
      status: response.status,
      body: response.body,
      expectedUserId,
      expectedDate,
      originFingerprint,
      credentialSource: canary.credentialSource,
      userSequence: canary.userSequence,
    })
  } catch {
    fail(stage)
  }

  return requirePassedCanary(classification, stage)
}

export async function runP2Premeasurement(options, dependencies) {
  validateInputs(options, dependencies)

  const { baseUrl, approvedTarget } = options
  const {
    executeCanary,
    loadFixtureEvidence,
    nowSeconds,
    observeDeployment,
    readDatabaseEvidence,
    readLoginPassword,
  } = dependencies

  const fixtureEvidence = validateFixtureEvidence(
    await runStage('load-fixture', () => loadFixtureEvidence()),
  )

  const { fixtureMetadata, designatedUser } = fixtureEvidence

  const plan = await runStage('build-plan', () =>
    buildP2PremeasurementCanaryPlan({
      baseUrl,
      approvedTarget,
      fixtureMetadata,
      designatedUser,
    }),
  )

  const deploymentEvidence = await runStage('observe-deployment', () => observeDeployment())
  const databaseEvidence = await runStage('read-database', () => readDatabaseEvidence())
  const observedTarget = buildObservedTarget(deploymentEvidence, databaseEvidence)

  const context = {
    approvedTarget,
    observedTarget,
    fixtureMetadata,
    designatedUser,
    databaseCurrentDate: databaseEvidence.databaseCurrentDate,
  }

  const firstClock = await readClock(nowSeconds, 'read-pre-canary-clock')

  assertPreCanaryReady({
    ...context,
    nowSeconds: firstClock,
  })

  const [healthCanary, loginCanary, protectedCanary] = plan.canaries

  const healthResult = await executeAndClassifyCanary({
    stage: 'health-canary',
    executeCanary,
    baseUrl,
    canary: healthCanary,
    credential: Object.freeze({ type: 'none' }),
    expectedUserId: null,
    expectedDate: databaseEvidence.databaseCurrentDate,
    originFingerprint: approvedTarget.originFingerprint,
  })

  const loginClock = await readClock(nowSeconds, 'read-login-clock')

  assertPreCanaryReady({
    ...context,
    nowSeconds: loginClock,
  })

  const loginPassword = await runStage('read-login-password', async () => {
    const password = await readLoginPassword()

    validatePerfLoginPassword(password)

    return password
  })

  const loginResult = await executeAndClassifyCanary({
    stage: 'login-canary',
    executeCanary,
    baseUrl,
    canary: loginCanary,
    credential: Object.freeze({
      type: 'runtime-login-password',
      email: fixtureMetadata.login.email,
      password: loginPassword,
    }),
    expectedUserId: designatedUser.userId,
    expectedDate: databaseEvidence.databaseCurrentDate,
    originFingerprint: approvedTarget.originFingerprint,
  })

  const protectedClock = await readClock(nowSeconds, 'read-protected-clock')

  assertPreCanaryReady({
    ...context,
    nowSeconds: protectedClock,
  })

  const protectedResult = await executeAndClassifyCanary({
    stage: 'protected-canary',
    executeCanary,
    baseUrl,
    canary: protectedCanary,
    credential: Object.freeze({
      type: 'fixture-token',
      token: designatedUser.token,
    }),
    expectedUserId: designatedUser.userId,
    expectedDate: databaseEvidence.databaseCurrentDate,
    originFingerprint: approvedTarget.originFingerprint,
  })

  const finalClock = await readClock(nowSeconds, 'read-final-clock')

  try {
    return assertP2PremeasurementReady({
      ...context,
      nowSeconds: finalClock,
      canaries: [healthResult, loginResult, protectedResult],
    })
  } catch {
    fail('final-gate')
  }
}
