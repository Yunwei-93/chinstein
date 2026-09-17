import {
    connectToStaging,
    PerfSafetyError,
    safeError,
} from "./staging-guard.mjs";
import {
    HISTORY_DAYS,
    CHARACTER_COUNT,
    POOLS,
    TOTAL_USERS,
    HISTORICAL_SESSIONS,
    TODAY_SESSIONS,
} from "./fixture-config.mjs";
import {
    analyzeSeededTables,
    verifySeededSessionQuality,
    verifySeededStructure,
    verifySeededUserDistribution,
} from "./seed-verification.mjs";
import {
    clearStagingDataset,
    createPerfMappings,
    createPerfPasswordHash,
    createPerfUsers,
    seedHistoricalSessions,
    seedTodayConflictSessions,
    setSyntheticStories,
} from "./seed-operations.mjs";
import {
    assertSafeSeedClock,
    assertSeedPrivileges,
} from "./seed-preflight.mjs";
import {
    assertCoreColumns,
    assertCoreRelations,
} from "./seed-schema-preflight.mjs";
import { assertApprovedSeedSourceDataset } from "./seed-dataset-preflight.mjs";
import { runRollbackSeedDryRun } from "./seed-dry-run.mjs";
import { runCommittedSeed } from "./seed-commit.mjs";

let connection;
let transactionOpen = false;
let stage = "validate-mode";


try {
    const args = process.argv.slice(2);

    const matchesExactArgs = (expectedArgs) =>
        args.length === expectedArgs.length &&
        args.every(
            (argument, index) => argument === expectedArgs[index]
        );

    const planRequested =
        args.length === 0 ||
        matchesExactArgs(["--plan"]);

    const dryRunArgs = [
        "--dry-run",
        "--confirm-aws-staging",
        "--confirm-ecs-zero"
    ];

    const initialCommitArgs = [
        "--commit-seed",
        "--confirm-aws-staging",
        "--confirm-ecs-zero",
        "--confirm-replace-approved-initial-dataset"
    ];

    const perfReseedCommitArgs = [
        "--commit-seed",
        "--confirm-aws-staging",
        "--confirm-ecs-zero",
        "--confirm-replace-approved-perf-dataset"
    ];

    const dryRunRequested = matchesExactArgs(dryRunArgs);
    const initialCommitRequested = matchesExactArgs(initialCommitArgs);
    const perfReseedCommitRequested =
        matchesExactArgs(perfReseedCommitArgs);

    const commitSeedRequested =
        initialCommitRequested || perfReseedCommitRequested;

    const expectedSourceClassification =
        initialCommitRequested
            ? "approved-initial-staging"
            : perfReseedCommitRequested
                ? "approved-perf-source"
                : null;
    if (
        !planRequested &&
        !dryRunRequested &&
        !commitSeedRequested
    ) {
        throw new PerfSafetyError(
            "Use --plan or one exact confirmed seed mode"
        );
    }

    const mode =
        commitSeedRequested
            ? "commit-seed"
            : dryRunRequested
                ? "dry-run"
                : "plan";

    if (mode === "commit-seed") {
        stage = "run-committed-seed";

        const committedSeedResult = await runCommittedSeed({
            expectedSourceClassification
        });

        console.log(JSON.stringify(
            committedSeedResult,
            null,
            2
        ));
    } else {
        stage = "connect-to-staging";
        connection = await connectToStaging();

        const { client, identity } = connection;

        if (mode === "dry-run") {
            stage = "run-rollback-dry-run";

            const dryRunResult =
                await runRollbackSeedDryRun(client);

            console.log(JSON.stringify({
                environment: identity,
                ...dryRunResult,
            }, null, 2));
        } else {
            stage = "read-current-dataset";
            await client.query("BEGIN READ ONLY");
            transactionOpen = true;

            await client.query("SET LOCAL statement_timeout = 180000");

            stage = "run-read-only-safety-gates";

            const preflightClock = await assertSafeSeedClock(client);
            const seedPrivileges = await assertSeedPrivileges(client);
            const coreRelations = await assertCoreRelations(client);
            const coreColumns = await assertCoreColumns(client);
            const approvedDataset = await assertApprovedSeedSourceDataset(client);

            stage = "read-current-dataset";

            const current = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM public.users)::bigint AS users,
      (
        SELECT COUNT(*)
        FROM public.study_sessions
      )::bigint AS study_sessions,
      (
        SELECT COUNT(*)
        FROM public.characters
      )::bigint AS characters,
      (
        SELECT COUNT(*)
        FROM public.characters
        WHERE story IS NOT NULL
      )::bigint AS existing_stories,
      (
        SELECT COUNT(*)
        FROM public.characters
        WHERE story_status = $1
      )::bigint AS generating_stories
  `, ["generating"]);

            const mappings = await client.query(`
    SELECT
      to_regclass($1)::text AS perf_users_table,
      to_regclass($2)::text AS perf_characters_table
  `, ["public.perf_users", "public.perf_characters"]);

            const privileges = await client.query(`
    SELECT
      has_table_privilege(
        current_user,
        $1,
        $2
      ) AS can_truncate_study_sessions,
      has_schema_privilege(
        current_user,
        $3,
        $4
      ) AS can_create_mapping_tables
  `, ["public.study_sessions", "TRUNCATE", "public", "CREATE"]);

            await client.query("COMMIT");
            transactionOpen = false;

            const currentData = current.rows[0];
            const permissions = privileges.rows[0];

            stage = "validate-prerequisites";

            if (Number(currentData.characters) !== CHARACTER_COUNT) {
                throw new PerfSafetyError(
                    "Character count differs from the frozen 365-character fixture"
                );
            }

            if (Number(currentData.generating_stories) !== 0) {
                throw new PerfSafetyError(
                    "Story generation is in progress; do not prepare a dataset replacement"
                );
            }

            if (
                !permissions.can_truncate_study_sessions ||
                !permissions.can_create_mapping_tables
            ) {
                throw new PerfSafetyError(
                    "Required staging dataset-maintenance permissions are missing"
                );
            }

            console.log(JSON.stringify({
                mode: "plan-only",
                writesEnabled: false,
                preflight: {
                    clock: preflightClock,
                    privileges: seedPrivileges,
                    coreRelations,
                    coreColumns,
                    dataset: approvedDataset,
                },
                environment: identity,
                currentData,
                mappings: mappings.rows[0],
                permissions,
                plannedData: {
                    pools: POOLS,
                    totalUsers: TOTAL_USERS,
                    historyDaysPerUser: HISTORY_DAYS,
                    historicalSessions: HISTORICAL_SESSIONS,
                    todaySessions: TODAY_SESSIONS,
                    totalSessions: HISTORICAL_SESSIONS + TODAY_SESSIONS,
                    charactersPreserved: CHARACTER_COUNT,
                    syntheticReadyStories: CHARACTER_COUNT,
                    storyAttemptsPerCharacter: 0,
                    derivationKey: "stable synthetic seq, not physical SERIAL IDs",
                    historyDateAnchor: "database date recorded at each reseed",
                },
                proposedReset: {
                    reclaimSessionsWith: "TRUNCATE public.study_sessions",
                    cleanupAndReplacementInOneTransaction: true,
                    replaceAllStagingUsers: true,
                    replacePerfMappingTables: true,
                    overwriteAllCharacterStories: true,
                    analyzeAfterSeeding: [
                        "public.study_sessions",
                        "public.characters",
                        "public.users",
                    ],
                },
            }, null, 2));
        }
    }
} catch (error) {
    if (connection && transactionOpen) {
        try {
            await connection.client.query("ROLLBACK");
        } catch {
        }
    }

    console.error(JSON.stringify(
        safeError(error, stage),
        null,
        2
    ));

    process.exitCode = 1;
} finally {
    if (connection) {
        try {
            await connection.client.end();
        } catch (error) {
            console.error(JSON.stringify(
                safeError(error, "close-connection"),
                null,
                2
            ));

            process.exitCode = 1;
        }
    }
}
