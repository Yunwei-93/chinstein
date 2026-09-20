import { connectToStaging, PerfSafetyError } from './staging-guard.mjs'
import { assertSafeSeedClock } from './seed-preflight.mjs'
import { assertCoreColumns, assertCoreRelations } from './seed-schema-preflight.mjs'
import {
  approvedSeedSourcesMatch,
  assertApprovedSeedSourceDataset,
} from './seed-dataset-preflight.mjs'
import {
  clearStagingDataset,
  createPerfMappings,
  assertPerfPasswordHash,
  createPerfUsers,
  rebuildLeaderboardScores,
  seedHistoricalSessions,
  seedTodayConflictSessions,
  setSyntheticStories,
} from './seed-operations.mjs'

import {
  analyzeSeededTables,
  verifyLeaderboardScores,
  verifySeededSessionQuality,
  verifySeededStructure,
  verifySeededUserDistribution,
} from './seed-verification.mjs'
import { lockApprovedSeedSource, runWriteSafetyGates } from './seed-source-guard.mjs'
import { captureCoreDatasetSnapshot, coreSnapshotsMatch } from './seed-source-snapshot.mjs'
import {
  classifyAmbiguousCommit,
  verifySourceRestoredWithFreshConnection,
} from './seed-commit-state.mjs'

const APPROVED_COMMIT_SOURCE_CLASSIFICATIONS = new Set([
  'approved-initial-staging',
  'approved-perf-source',
])

// Preserve the failing stage without exposing raw database errors.
function toCommitError(error, stage) {
  if (error instanceof PerfSafetyError) {
    return new PerfSafetyError(
      `Committed seed stopped during ${stage}: ${error.message}`,
      error.code,
    )
  }

  return new PerfSafetyError(
    `Committed seed failed during ${stage}; raw error suppressed`,
    typeof error?.code === 'string' ? error.code : null,
  )
}

// Report whether a pre-commit rollback was actually accepted.
async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK')
    return true
  } catch {
    return false
  }
}

// Verify the committed fixture through one stable fresh connection.
async function verifyCommittedSeedWithFreshConnection(seedDate, expectedDataset, expectedSnapshot) {
  if (expectedDataset?.classification !== 'approved-perf-source' || !expectedSnapshot) {
    throw new PerfSafetyError('Post-commit verification requires the expected PERF target state')
  }

  let connection
  let transactionOpen = false
  let stage = 'connect-fresh-staging'

  try {
    connection = await connectToStaging()
    const { client, identity } = connection

    stage = 'begin-read-only-verification'
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    transactionOpen = true

    await client.query("SET LOCAL TIME ZONE 'UTC'")
    await client.query('SET LOCAL lock_timeout = 5000')
    await client.query('SET LOCAL statement_timeout = 900000')

    stage = 'verify-post-commit-clock'
    const clock = await assertSafeSeedClock(client)

    if (clock.seedDate !== seedDate) {
      throw new PerfSafetyError('Post-commit verification date differs from the seed date')
    }

    stage = 'verify-post-commit-relations'
    const coreRelations = await assertCoreRelations(client)

    stage = 'verify-post-commit-columns'
    const coreColumns = await assertCoreColumns(client)

    stage = 'verify-post-commit-structure'
    const structure = await verifySeededStructure(client, seedDate)

    stage = 'verify-post-commit-leaderboard-scores'
    const leaderboard = await verifyLeaderboardScores(client)

    stage = 'verify-post-commit-distribution'
    const distribution = await verifySeededUserDistribution(client, seedDate)

    stage = 'verify-post-commit-session-quality'
    const sessionQuality = await verifySeededSessionQuality(client, seedDate)

    stage = 'verify-post-commit-approved-source'
    const approvedDataset = await assertApprovedSeedSourceDataset(client, {
      expectedClassification: 'approved-perf-source',
    })

    if (!approvedSeedSourcesMatch(expectedDataset, approvedDataset)) {
      throw new PerfSafetyError('Committed PERF identity differs from the pre-commit target')
    }

    stage = 'capture-post-commit-snapshot'
    const observedSnapshot = await captureCoreDatasetSnapshot(client)

    if (!coreSnapshotsMatch(expectedSnapshot, observedSnapshot)) {
      throw new PerfSafetyError('Committed core data differs from the pre-commit target')
    }

    stage = 'finish-read-only-verification'
    await client.query('COMMIT')
    transactionOpen = false

    return {
      environment: identity,
      clock,
      coreRelations,
      coreColumns,
      structure,
      leaderboard,
      distribution,
      sessionQuality,
      approvedDataset,
      targetIdentityVerified: true,
      targetSnapshotVerified: true,
      snapshotCounts: {
        users: observedSnapshot.users,
        studySessions: observedSnapshot.studySessions,
        characters: observedSnapshot.characters,
      },
      fingerprintsPrinted: false,
    }
  } catch (error) {
    let rollbackConfirmed = !transactionOpen

    if (connection && transactionOpen) {
      rollbackConfirmed = await rollbackQuietly(connection.client)
      transactionOpen = false
    }

    const wrapped = toCommitError(error, `post-commit-${stage}`)

    if (!rollbackConfirmed) {
      throw new PerfSafetyError(
        `${wrapped.message}; read-only rollback could not be confirmed`,
        wrapped.code,
      )
    }

    throw wrapped
  } finally {
    if (connection) {
      try {
        await connection.client.end()
      } catch {}
    }
  }
}

// Build and verify the complete fixture inside the caller's transaction.
async function buildAndVerifySeedInCurrentTransaction(client, seedDate, passwordHash) {
  let stage = 'clear-staging-dataset'

  try {
    const cleanup = await clearStagingDataset(client)

    // The cleanup helper uses 60 seconds. Large fixture statements
    // need a longer bounded timeout.
    await client.query('SET LOCAL statement_timeout = 900000')

    stage = 'create-perf-mappings'
    const mappings = await createPerfMappings(client)

    stage = 'create-perf-users'
    const users = await createPerfUsers(client, passwordHash)

    stage = 'set-synthetic-stories'
    const stories = await setSyntheticStories(client)

    stage = 'seed-historical-sessions'
    const history = await seedHistoricalSessions(client, seedDate)

    stage = 'seed-pool-b-sessions'
    const conflicts = await seedTodayConflictSessions(client, seedDate)

    stage = 'rebuild-leaderboard-scores'
    const leaderboardScores = await rebuildLeaderboardScores(client)

    stage = 'analyze-seeded-tables'
    const analysis = await analyzeSeededTables(client)

    stage = 'verify-seeded-structure'
    const structure = await verifySeededStructure(client, seedDate)

    stage = 'verify-leaderboard-scores'
    const leaderboard = await verifyLeaderboardScores(client)

    stage = 'verify-user-distribution'
    const distribution = await verifySeededUserDistribution(client, seedDate)

    stage = 'verify-session-quality'
    const sessionQuality = await verifySeededSessionQuality(client, seedDate)

    stage = 'final-write-clock-check'
    const finalClock = await assertSafeSeedClock(client, { requireReadWrite: true })

    if (finalClock.seedDate !== seedDate) {
      throw new PerfSafetyError('Database date changed during the committed seed transaction')
    }

    return {
      operations: {
        cleanup,
        mappings,
        users,
        stories,
        history,
        conflicts,
        leaderboardScores,
        analysis,
      },
      verification: {
        structure,
        leaderboard,
        distribution,
        sessionQuality,
        finalClock,
      },
    }
  } catch (error) {
    throw toCommitError(error, `write-transaction-${stage}`)
  }
}

// Commit the complete fixture atomically, then verify it independently.
export async function runCommittedSeed({
  expectedSourceClassification,
  passwordHash: suppliedPasswordHash,
} = {}) {
  if (!APPROVED_COMMIT_SOURCE_CLASSIFICATIONS.has(expectedSourceClassification)) {
    throw new PerfSafetyError('Committed seed requires one exact approved source classification')
  }

  let connection
  let environment
  let transactionOpen = false
  let writeTransactionStarted = false
  let commitStarted = false
  let commitConfirmed = false
  let sequenceValuesMayAdvance = false
  let passwordHash = null
  let seedDate = null
  let sourceDataset = null
  let sourceSnapshot = null
  let targetDataset = null
  let targetSnapshot = null
  let stage = 'validate-password-hash'

  try {
    passwordHash = assertPerfPasswordHash(suppliedPasswordHash)

    stage = 'connect-primary-staging'
    connection = await connectToStaging()
    environment = connection.identity

    const { client } = connection

    stage = 'begin-read-write'
    await client.query('BEGIN READ WRITE')
    transactionOpen = true
    writeTransactionStarted = true

    await client.query('SET LOCAL lock_timeout = 5000')
    await client.query('SET LOCAL statement_timeout = 180000')

    stage = 'preflight-before-lock'
    const preflightBeforeLock = await runWriteSafetyGates(client, {
      expectedClassification: expectedSourceClassification,
    })

    sourceDataset = preflightBeforeLock.dataset
    seedDate = preflightBeforeLock.clock.seedDate

    stage = 'lock-approved-source'
    await lockApprovedSeedSource(client, sourceDataset)

    // Locked PERF-source checks and fingerprints may scan 1.46 million rows.
    stage = 'prepare-locked-source-checks'
    await client.query('SET LOCAL statement_timeout = 900000')

    stage = 'preflight-under-lock'
    const preflightUnderLock = await runWriteSafetyGates(client, {
      expectedDataset: sourceDataset,
    })

    sourceDataset = preflightUnderLock.dataset

    if (preflightUnderLock.clock.seedDate !== seedDate) {
      throw new PerfSafetyError('Database date changed while acquiring the source locks')
    }

    stage = 'capture-source-snapshot'
    sourceSnapshot = await captureCoreDatasetSnapshot(client)

    // From this point, INSERT statements may consume sequence values.
    sequenceValuesMayAdvance = true

    stage = 'build-and-verify-fixture'
    const fixture = await buildAndVerifySeedInCurrentTransaction(client, seedDate, passwordHash)

    stage = 'validate-target-dataset'
    targetDataset = await assertApprovedSeedSourceDataset(client, {
      expectedClassification: 'approved-perf-source',
    })

    if (targetDataset.sourceSeedDate !== seedDate) {
      throw new PerfSafetyError('Target fixture date differs from the transaction seed date')
    }

    stage = 'capture-target-snapshot'
    targetSnapshot = await captureCoreDatasetSnapshot(client)

    stage = 'prove-target-differs-from-source'

    if (coreSnapshotsMatch(sourceSnapshot, targetSnapshot)) {
      throw new PerfSafetyError('Replacement target is indistinguishable from its source')
    }

    // Validation and fingerprinting may cross UTC midnight.
    stage = 'pre-commit-clock-check'
    const preCommitClock = await assertSafeSeedClock(client, {
      requireReadWrite: true,
    })

    if (preCommitClock.seedDate !== seedDate) {
      throw new PerfSafetyError('Database date changed before the seed transaction committed')
    }

    // Once COMMIT starts, an error cannot be treated as a rollback.
    stage = 'commit-write-transaction'
    commitStarted = true

    await client.query('COMMIT')

    commitConfirmed = true
    transactionOpen = false

    // Close the writer before verifying visibility from another session.
    stage = 'close-primary-after-commit'

    try {
      await connection.client.end()
    } catch {}

    connection = undefined

    stage = 'verify-committed-fixture'
    const postCommit = await verifyCommittedSeedWithFreshConnection(
      seedDate,
      targetDataset,
      targetSnapshot,
    )

    return {
      environment,
      mode: 'committed-seed',
      atomicReplacementTransaction: true,
      committed: true,
      commitOutcome: 'confirmed',
      postCommitVerified: true,
      sequenceValuesMayAdvance: true,
      seedDate,
      sourceClassification: sourceDataset.classification,
      targetClassification: targetDataset.classification,
      preflight: {
        beforeLock: preflightBeforeLock,
        underLock: preflightUnderLock,
      },
      operations: fixture.operations,
      verification: {
        ...fixture.verification,
        preCommitClock,
      },
      replacementEvidence: {
        sourceCounts: {
          users: sourceSnapshot.users,
          studySessions: sourceSnapshot.studySessions,
          characters: sourceSnapshot.characters,
        },
        targetCounts: {
          users: targetSnapshot.users,
          studySessions: targetSnapshot.studySessions,
          characters: targetSnapshot.characters,
        },
        targetDiffersFromSource: true,
        fingerprintsPrinted: false,
      },
      postCommit,
    }
  } catch (error) {
    const wrapped = toCommitError(error, stage)

    // Before COMMIT begins, rollback is still a valid recovery action.
    if (!commitStarted) {
      let rollbackConfirmed = !transactionOpen

      if (connection && transactionOpen) {
        rollbackConfirmed = await rollbackQuietly(connection.client)
        transactionOpen = false
      }

      if (connection) {
        try {
          await connection.client.end()
        } catch {}

        connection = undefined
      }

      let sourceRestoration = 'not-checked'

      if (sourceDataset) {
        try {
          const restored = await verifySourceRestoredWithFreshConnection({
            expectedDataset: sourceDataset,
            expectedSnapshot: sourceSnapshot,
          })

          sourceRestoration =
            restored.snapshotRestored === true
              ? 'identity-and-core-snapshot-restored'
              : 'identity-restored-snapshot-not-captured'
        } catch {
          sourceRestoration = 'not-verified'
        }
      }

      const messages = [wrapped.message, 'committed=false']

      if (writeTransactionStarted) {
        messages.push(
          `rollbackConfirmed=${rollbackConfirmed}`,
          `sourceRestoration=${sourceRestoration}`,
        )
      }

      if (sequenceValuesMayAdvance) {
        messages.push('sequence values may have advanced')
      }

      messages.push('ECS staging must remain drained')

      throw new PerfSafetyError(messages.join('; '), wrapped.code)
    }

    // A COMMIT error must be classified through a fresh read-only connection.
    if (!commitConfirmed) {
      if (connection) {
        try {
          await connection.client.end()
        } catch {}

        connection = undefined
      }

      transactionOpen = false

      const observation = await classifyAmbiguousCommit({
        sourceDataset,
        sourceSnapshot,
        targetDataset,
        targetSnapshot,
      })

      const observedCommitOutcome =
        observation.classification === 'committed-target-visible'
          ? 'committed'
          : observation.classification === 'not-committed-source-restored'
            ? 'not-committed'
            : 'unknown'

      throw new PerfSafetyError(
        [
          wrapped.message,
          `commitOutcome=${observedCommitOutcome}`,
          `freshState=${observation.classification}`,
          'sequence values may have advanced',
          'no automatic retry was attempted',
          'ECS staging must remain drained',
        ].join('; '),
        wrapped.code,
      )
    }

    // A confirmed COMMIT cannot be undone by a later verification failure.
    if (connection) {
      try {
        await connection.client.end()
      } catch {}

      connection = undefined
    }

    throw new PerfSafetyError(
      [
        wrapped.message,
        'committed=true',
        'postCommitVerified=false',
        'no automatic cleanup or retry was attempted',
        'ECS staging must remain drained',
      ].join('; '),
      wrapped.code,
    )
  } finally {
    // Drop the local reference; the hash is never printed or returned.
    passwordHash = null

    if (connection) {
      try {
        await connection.client.end()
      } catch {}
    }
  }
}
