import {
    connectToStaging,
    PerfSafetyError
} from "./staging-guard.mjs";
import {
    approvedSeedSourceIdentity,
    approvedSeedSourcesMatch,
    assertApprovedSeedSourceDataset
} from "./seed-dataset-preflight.mjs";
import {
    captureCoreDatasetSnapshot,
    coreSnapshotsMatch
} from "./seed-source-snapshot.mjs";

function toStateError(error, stage) {
    if (error instanceof PerfSafetyError) {
        return new PerfSafetyError(
            `Seed state check stopped during ${stage}: ${error.message}`,
            error.code
        );
    }

    return new PerfSafetyError(
        `Seed state check failed during ${stage}; raw error suppressed`,
        typeof error?.code === "string" ? error.code : null
    );
}

async function rollbackQuietly(client) {
    try {
        await client.query("ROLLBACK");
        return true;
    } catch {
        return false;
    }
}

function snapshotCounts(snapshot) {
    return {
        users: snapshot.users,
        studySessions: snapshot.studySessions,
        characters: snapshot.characters
    };
}

// Read the approved dataset identity and fingerprints from one stable view.
export async function readApprovedStateWithFreshConnection(
    { expectedClassification = null } = {}
) {
    let connection;
    let transactionOpen = false;
    let stage = "connect-fresh-staging";

    try {
        connection = await connectToStaging();
        const { client, identity: environment } = connection;

        stage = "begin-stable-read";
        await client.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        );
        transactionOpen = true;

        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query("SET LOCAL lock_timeout = 5000");
        await client.query("SET LOCAL statement_timeout = 900000");

        stage = "validate-approved-dataset";
        const dataset = await assertApprovedSeedSourceDataset(client, {
            expectedClassification
        });

        stage = "capture-core-snapshot";
        const snapshot = await captureCoreDatasetSnapshot(client);

        stage = "finish-stable-read";
        await client.query("COMMIT");
        transactionOpen = false;

        return {
            environment,
            dataset,
            identity: approvedSeedSourceIdentity(dataset),
            snapshot
        };
    } catch (error) {
        let rollbackConfirmed = !transactionOpen;

        if (connection && transactionOpen) {
            rollbackConfirmed = await rollbackQuietly(connection.client);
            transactionOpen = false;
        }

        const wrapped = toStateError(error, stage);

        if (!rollbackConfirmed) {
            throw new PerfSafetyError(
                `${wrapped.message}; read-only rollback could not be confirmed`,
                wrapped.code
            );
        }

        throw wrapped;
    } finally {
        if (connection) {
            try {
                await connection.client.end();
            } catch {
            }
        }
    }
}

// Prove that rollback restored the original approved source.
export async function verifySourceRestoredWithFreshConnection({
    expectedDataset,
    expectedSnapshot = null
}) {
    if (!expectedDataset) {
        throw new PerfSafetyError(
            "Source restoration verification requires an expected dataset"
        );
    }

    const expectedIdentity = approvedSeedSourceIdentity(expectedDataset);
    const observed = await readApprovedStateWithFreshConnection({
        expectedClassification: expectedIdentity.classification
    });

    const identityRestored = approvedSeedSourcesMatch(
        expectedDataset,
        observed.dataset
    );

    const snapshotRestored =
        expectedSnapshot === null
            ? null
            : coreSnapshotsMatch(expectedSnapshot, observed.snapshot);

    if (!identityRestored) {
        throw new PerfSafetyError(
            "Approved source identity was not restored after rollback"
        );
    }

    if (snapshotRestored === false) {
        throw new PerfSafetyError(
            "Core source data was not restored after rollback"
        );
    }

    return {
        environment: observed.environment,
        classification: observed.identity.classification,
        identityRestored: true,
        snapshotRestored,
        counts: snapshotCounts(observed.snapshot),
        fingerprintsPrinted: false
    };
}

// Observe an uncertain COMMIT once without retrying any write.
export async function classifyAmbiguousCommit({
    sourceDataset,
    sourceSnapshot,
    targetDataset,
    targetSnapshot
}) {
    approvedSeedSourceIdentity(sourceDataset);
    approvedSeedSourceIdentity(targetDataset);

    if (!sourceSnapshot || !targetSnapshot) {
        throw new PerfSafetyError(
            "Ambiguous commit classification requires both snapshots"
        );
    }

    try {
        const observed = await readApprovedStateWithFreshConnection();

        const sourceIdentityVisible = approvedSeedSourcesMatch(
            sourceDataset,
            observed.dataset
        );
        const sourceSnapshotVisible = coreSnapshotsMatch(
            sourceSnapshot,
            observed.snapshot
        );
        const targetIdentityVisible = approvedSeedSourcesMatch(
            targetDataset,
            observed.dataset
        );
        const targetSnapshotVisible = coreSnapshotsMatch(
            targetSnapshot,
            observed.snapshot
        );

        const sourceVisible =
            sourceIdentityVisible && sourceSnapshotVisible;
        const targetVisible =
            targetIdentityVisible && targetSnapshotVisible;

        let classification;

        if (sourceVisible && targetVisible) {
            classification = "indistinguishable";
        } else if (sourceVisible) {
            classification = "not-committed-source-restored";
        } else if (targetVisible) {
            classification = "committed-target-visible";
        } else {
            classification = "unexpected-state";
        }

        return {
            classification,
            observedClassification: observed.identity.classification,
            sourceIdentityVisible,
            sourceSnapshotVisible,
            targetIdentityVisible,
            targetSnapshotVisible,
            observedCounts: snapshotCounts(observed.snapshot),
            fingerprintsPrinted: false
        };
    } catch (error) {
        return {
            classification: "unobservable",
            observedClassification: null,
            sourceIdentityVisible: null,
            sourceSnapshotVisible: null,
            targetIdentityVisible: null,
            targetSnapshotVisible: null,
            observerErrorCode:
                typeof error?.code === "string" ? error.code : null,
            fingerprintsPrinted: false
        };
    }
}