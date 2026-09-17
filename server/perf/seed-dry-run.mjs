import { PerfSafetyError } from "./staging-guard.mjs";
import { assertSafeSeedClock } from "./seed-preflight.mjs";
import {
    approvedSeedSourcesMatch,
    assertApprovedSeedSourceDataset
} from "./seed-dataset-preflight.mjs";
import {
    clearStagingDataset,
    createPerfMappings,
    createPerfPasswordHash,
    createPerfUsers,
    seedHistoricalSessions,
    seedTodayConflictSessions,
    setSyntheticStories
} from "./seed-operations.mjs";
import {
    analyzeSeededTables,
    verifySeededSessionQuality,
    verifySeededStructure,
    verifySeededUserDistribution
} from "./seed-verification.mjs";
import {
    captureCoreDatasetSnapshot,
    coreSnapshotsMatch,
} from "./seed-source-snapshot.mjs";
import {
    lockApprovedSeedSource,
    runWriteSafetyGates
} from "./seed-source-guard.mjs";

// Preserve the failing stage without exposing raw database errors.
function toDryRunError(error, stage) {
    if (error instanceof PerfSafetyError) {
        return new PerfSafetyError(
            `Rollback dry-run stopped during ${stage}: ${error.message}`,
            error.code
        );
    }

    return new PerfSafetyError(
        `Rollback dry-run failed during ${stage}; raw error suppressed`,
        typeof error?.code === "string"
            ? error.code
            : null
    );
}

// Make rollback best-effort while preserving the original failure.
async function rollbackQuietly(client) {
    try {
        await client.query("ROLLBACK");
        return true;
    } catch {
        return false;
    }
}

// Rehearse the complete seed and always roll back the write transaction.
export async function runRollbackSeedDryRun(client) {
    let transactionOpen = false;
    let sequenceValuesMayAdvance = false;
    let passwordHash = null;
    let stage = "validate-client";

    if (!client || typeof client.query !== "function") {
        throw new PerfSafetyError(
            "Rollback dry-run requires a guarded staging client"
        );
    }

    try {
        // Keep bcrypt work outside the database transaction and table locks.
        stage = "create-password-hash";
        passwordHash = await createPerfPasswordHash();

        stage = "begin-read-write";
        await client.query("BEGIN READ WRITE");
        transactionOpen = true;

        await client.query("SET LOCAL lock_timeout = 5000");
        await client.query("SET LOCAL statement_timeout = 180000");

        stage = "preflight-before-lock";
        const preflightBeforeLock = await runWriteSafetyGates(client);
        const seedDate = preflightBeforeLock.clock.seedDate;

        stage = "lock-approved-source";
        await lockApprovedSeedSource(client, preflightBeforeLock.dataset);

        stage = "preflight-under-lock";
        const preflightUnderLock = await runWriteSafetyGates(client, {
            expectedDataset: preflightBeforeLock.dataset
        });

        if (preflightUnderLock.clock.seedDate !== seedDate) {
            throw new PerfSafetyError(
                "Database date changed while acquiring the source locks"
            );
        }

        // Fingerprinting and fixture construction may scan all session rows.
        await client.query("SET LOCAL statement_timeout = 900000");

        stage = "capture-original-dataset";
        const originalSnapshot = await captureCoreDatasetSnapshot(client);

        stage = "clear-staging-dataset";
        const cleanup = await clearStagingDataset(client);

        stage = "create-perf-mappings";
        const mappings =
            await createPerfMappings(client);

        // PostgreSQL sequence values are not restored by ROLLBACK.
        sequenceValuesMayAdvance = true;

        stage = "create-perf-users";
        const users =
            await createPerfUsers(
                client,
                passwordHash
            );

        stage = "set-synthetic-stories";
        const stories =
            await setSyntheticStories(client);

        stage = "seed-historical-sessions";
        const history =
            await seedHistoricalSessions(
                client,
                seedDate
            );

        stage = "seed-pool-b-sessions";
        const conflicts =
            await seedTodayConflictSessions(
                client,
                seedDate
            );

        stage = "analyze-seeded-tables";
        const analysis =
            await analyzeSeededTables(client);

        stage = "verify-seeded-structure";
        const structure =
            await verifySeededStructure(
                client,
                seedDate
            );

        stage = "verify-user-distribution";
        const distribution =
            await verifySeededUserDistribution(
                client,
                seedDate
            );

        stage = "verify-session-quality";
        const sessionQuality =
            await verifySeededSessionQuality(
                client,
                seedDate
            );

        // Reject the rehearsal if it entered the UTC midnight guard window.
        stage = "final-write-clock-check";
        const finalClock = await assertSafeSeedClock(
            client,
            { requireReadWrite: true }
        );

        if (finalClock.seedDate !== seedDate) {
            throw new PerfSafetyError(
                "Database date changed during the rollback rehearsal"
            );
        }

        // Success still means rollback: this rehearsal never commits rows.
        stage = "rollback-write-transaction";
        await client.query("ROLLBACK");
        transactionOpen = false;

        // Verify restoration in a new read-only transaction.
        stage = "begin-restoration-check";
        await client.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        );
        transactionOpen = true;

        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query("SET LOCAL statement_timeout = 900000");

        stage = "verify-restored-dataset";
        const restoredDataset =
            await assertApprovedSeedSourceDataset(client);

        const sourceIdentityRestored = approvedSeedSourcesMatch(
            preflightUnderLock.dataset,
            restoredDataset
        );

        if (!sourceIdentityRestored) {
            throw new PerfSafetyError(
                "Approved source identity differs after rollback"
            );
        }

        const restoredSnapshot =
            await captureCoreDatasetSnapshot(client);

        const restorationVerified =
            coreSnapshotsMatch(originalSnapshot, restoredSnapshot);

        if (!restorationVerified) {
            throw new PerfSafetyError("Core staging data differs after rollback");
        }

        stage = "finish-restoration-check";
        await client.query("COMMIT");
        transactionOpen = false;

        return {
            mode: "rollback-dry-run",
            committed: false,
            rolledBack: true,
            restorationVerified: true,
            sequenceValuesMayAdvance: true,
            seedDate,
            sourceClassification: preflightUnderLock.dataset.classification,
            preflight: {
                beforeLock: preflightBeforeLock,
                underLock: preflightUnderLock,
            },
            operations: {
                cleanup,
                mappings,
                users,
                stories,
                history,
                conflicts,
                analysis,
            },
            verification: {
                structure,
                distribution,
                sessionQuality,
                finalClock,
            },
            restoration: {
                approvedDataset: restoredDataset,
                originalCounts: {
                    users: originalSnapshot.users,
                    studySessions:
                        originalSnapshot.studySessions,
                    characters:
                        originalSnapshot.characters,
                },
                restoredCounts: {
                    users: restoredSnapshot.users,
                    studySessions: restoredSnapshot.studySessions,
                    characters: restoredSnapshot.characters,
                },
                fingerprintsPrinted: false,
            },
        };
    } catch (error) {
        let rollbackConfirmed = !transactionOpen;

        if (transactionOpen) {
            rollbackConfirmed = await rollbackQuietly(client);
            transactionOpen = false;
        }

        const wrapped = toDryRunError(error, stage);
        const messages = [wrapped.message];

        if (!rollbackConfirmed) {
            messages.push("Rollback could not be confirmed");
        }

        if (sequenceValuesMayAdvance) {
            messages.push("Sequence values may have advanced");
        }

        throw new PerfSafetyError(messages.join("; "), wrapped.code);
    } finally {
        // Drop this reference; the hash is never printed or returned.
        passwordHash = null;
    }
}
