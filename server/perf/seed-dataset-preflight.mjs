import { PerfSafetyError } from "./staging-guard.mjs";
import {
    HISTORY_DAYS,
    CHARACTER_COUNT,
    POOLS,
    TOTAL_USERS,
    HISTORICAL_SESSIONS,
    TODAY_SESSIONS,
    SYNTHETIC_STORY,
    SYNTHETIC_STORY_SOURCE,
} from "./fixture-config.mjs";
import { inspectPerfSessionFacts } from "./seed-fixture-inspection.mjs";
const PERF_MAPPING_RELATIONS = [
    "perf_characters",
    "perf_users",
];


// Verify that both PERF mapping tables have the exact approved columns.
async function assertPerfMappingColumnContract(client) {
    const result = await client.query(`
        SELECT
            table_name,
            column_name,
            ordinal_position::integer AS ordinal_position,
            data_type,
            (is_nullable = 'YES') AS is_nullable,
            (column_default IS NOT NULL) AS has_default
        FROM information_schema.columns
        WHERE
            table_schema = 'public'
            AND table_name = ANY($1::text[])
        ORDER BY
            table_name,
            ordinal_position
    `, [[
        "perf_characters",
        "perf_users",
    ]]);

    const expectedColumns = [
        {
            table_name: "perf_characters",
            column_name: "seq",
            ordinal_position: 1,
            data_type: "integer",
            is_nullable: false,
            has_default: false,
        },
        {
            table_name: "perf_characters",
            column_name: "character_id",
            ordinal_position: 2,
            data_type: "integer",
            is_nullable: false,
            has_default: false,
        },
        {
            table_name: "perf_users",
            column_name: "seq",
            ordinal_position: 1,
            data_type: "integer",
            is_nullable: false,
            has_default: false,
        },
        {
            table_name: "perf_users",
            column_name: "user_id",
            ordinal_position: 2,
            data_type: "integer",
            is_nullable: false,
            has_default: false,
        },
    ];

    const columnsMatch =
        result.rows.length === expectedColumns.length &&
        result.rows.every((column, index) => {
            const expected = expectedColumns[index];

            return (
                column.table_name === expected.table_name &&
                column.column_name === expected.column_name &&
                column.ordinal_position ===
                expected.ordinal_position &&
                column.data_type === expected.data_type &&
                column.is_nullable === expected.is_nullable &&
                column.has_default === expected.has_default
            );
        });

    if (!columnsMatch) {
        throw new PerfSafetyError(
            "PERF mapping table columns do not match the approved contract"
        );
    }

    return {
        columnsChecked: expectedColumns.length,
    };
}

// Verify ownership and deterministic identity for every PERF user.
async function assertPerfFixtureUsers(client) {
    const result = await client.query(`
        WITH mapping_audit AS (
            SELECT
                COUNT(*)::bigint AS mappings,
                COUNT(DISTINCT pu.seq)::bigint
                    AS distinct_sequences,
                COUNT(DISTINCT pu.user_id)::bigint
                    AS distinct_users,
                MIN(pu.seq)::integer
                    AS minimum_sequence,
                MAX(pu.seq)::integer
                    AS maximum_sequence,
                COUNT(*) FILTER (
                    WHERE u.id IS NULL
                )::bigint AS dangling_mappings
            FROM public.perf_users AS pu
            LEFT JOIN public.users AS u
                ON u.id = pu.user_id
        ),

        user_audit AS (
            SELECT
                COUNT(*)::bigint AS users,
                COUNT(DISTINCT u.password_hash)::bigint
                    AS distinct_password_hashes,
                COUNT(*) FILTER (
                    WHERE pu.user_id IS NULL
                )::bigint AS unmapped_users,
                COUNT(*) FILTER (
                    WHERE
                        pu.user_id IS NULL
                        OR u.name IS DISTINCT FROM
                            'player_'
                            || LPAD(pu.seq::text, 5, '0')
                        OR u.email IS DISTINCT FROM
                            'player_'
                            || LPAD(pu.seq::text, 5, '0')
                            || '@perf.invalid'
                        OR CHAR_LENGTH(u.password_hash)
                            IS DISTINCT FROM 60
                        OR LEFT(u.password_hash, 7)
                            IS DISTINCT FROM '$2b$10$'
                        OR u.leaderboard_name_public
                            IS NOT TRUE
                )::bigint AS invalid_users
            FROM public.users AS u
            LEFT JOIN public.perf_users AS pu
                ON pu.user_id = u.id
        )

        SELECT
            mapping_audit.mappings,
            mapping_audit.distinct_sequences,
            mapping_audit.distinct_users,
            mapping_audit.minimum_sequence,
            mapping_audit.maximum_sequence,
            mapping_audit.dangling_mappings,
            user_audit.users,
            user_audit.distinct_password_hashes,
            user_audit.unmapped_users,
            user_audit.invalid_users
        FROM mapping_audit
        CROSS JOIN user_audit
    `);

    const state = result.rows[0];

    if (
        !state ||
        Number(state.mappings) !== TOTAL_USERS ||
        Number(state.distinct_sequences) !== TOTAL_USERS ||
        Number(state.distinct_users) !== TOTAL_USERS ||
        Number(state.minimum_sequence) !== 1 ||
        Number(state.maximum_sequence) !== TOTAL_USERS ||
        Number(state.dangling_mappings) !== 0 ||
        Number(state.users) !== TOTAL_USERS ||
        Number(state.distinct_password_hashes) !== 1 ||
        Number(state.unmapped_users) !== 0 ||
        Number(state.invalid_users) !== 0
    ) {
        throw new PerfSafetyError(
            "PERF source user ownership checks"
        );
    }

    return {
        users: Number(state.users),
        userMappings: Number(state.mappings),
        userSequenceRange: {
            minimum: Number(state.minimum_sequence),
            maximum: Number(state.maximum_sequence),
        },
        distinctPasswordHashes:
            Number(state.distinct_password_hashes),
        invalidUsers: Number(state.invalid_users),
    };
}

// Verify character mappings and canonical synthetic stories.
async function assertPerfFixtureCharacters(client) {
    const result = await client.query(`
        WITH expected_character_order AS (
            SELECT
                c.id AS character_id,
                ROW_NUMBER() OVER (
                    ORDER BY c.id
                )::integer AS expected_sequence
            FROM public.characters AS c
        ),

        mapping_differences AS (
            SELECT 1
            FROM expected_character_order AS expected
            FULL OUTER JOIN public.perf_characters AS pc
                ON pc.character_id =
                    expected.character_id
            WHERE
                expected.character_id IS NULL
                OR pc.character_id IS NULL
                OR pc.seq IS DISTINCT FROM
                    expected.expected_sequence
        ),

        mapping_audit AS (
            SELECT
                COUNT(*)::bigint AS mappings,
                COUNT(DISTINCT pc.seq)::bigint
                    AS distinct_sequences,
                COUNT(DISTINCT pc.character_id)::bigint
                    AS distinct_characters,
                MIN(pc.seq)::integer
                    AS minimum_sequence,
                MAX(pc.seq)::integer
                    AS maximum_sequence,
                COUNT(*) FILTER (
                    WHERE c.id IS NULL
                )::bigint AS dangling_mappings
            FROM public.perf_characters AS pc
            LEFT JOIN public.characters AS c
                ON c.id = pc.character_id
        ),

        character_audit AS (
            SELECT
                COUNT(*)::bigint AS characters,
                COUNT(*) FILTER (
                    WHERE pc.character_id IS NULL
                )::bigint AS unmapped_characters,
                COUNT(*) FILTER (
                    WHERE
                        c.story IS DISTINCT FROM $1
                        OR c.story_status
                            IS DISTINCT FROM 'ready'
                        OR c.story_source
                            IS DISTINCT FROM $2
                        OR c.story_attempts
                            IS DISTINCT FROM 0
                        OR c.story_started_at IS NOT NULL
                )::bigint AS invalid_stories
            FROM public.characters AS c
            LEFT JOIN public.perf_characters AS pc
                ON pc.character_id = c.id
        )

        SELECT
            mapping_audit.mappings,
            mapping_audit.distinct_sequences,
            mapping_audit.distinct_characters,
            mapping_audit.minimum_sequence,
            mapping_audit.maximum_sequence,
            mapping_audit.dangling_mappings,
            character_audit.characters,
            character_audit.unmapped_characters,
            character_audit.invalid_stories,
            (
                SELECT COUNT(*)
                FROM mapping_differences
            )::bigint AS mapping_differences
        FROM mapping_audit
        CROSS JOIN character_audit
    `, [
        SYNTHETIC_STORY,
        SYNTHETIC_STORY_SOURCE,
    ]);

    const state = result.rows[0];

    if (
        !state ||
        Number(state.mappings) !== CHARACTER_COUNT ||
        Number(state.distinct_sequences) !==
        CHARACTER_COUNT ||
        Number(state.distinct_characters) !==
        CHARACTER_COUNT ||
        Number(state.minimum_sequence) !== 1 ||
        Number(state.maximum_sequence) !==
        CHARACTER_COUNT ||
        Number(state.dangling_mappings) !== 0 ||
        Number(state.characters) !== CHARACTER_COUNT ||
        Number(state.unmapped_characters) !== 0 ||
        Number(state.invalid_stories) !== 0 ||
        Number(state.mapping_differences) !== 0
    ) {
        throw new PerfSafetyError(
            "PERF fixture character ownership checks failed"
        );
    }

    return {
        characters: Number(state.characters),
        characterMappings: Number(state.mappings),
        characterSequenceRange: {
            minimum: Number(state.minimum_sequence),
            maximum: Number(state.maximum_sequence),
        },
        syntheticStories: CHARACTER_COUNT,
        invalidStories: Number(state.invalid_stories),
        mappingDifferences:
            Number(state.mapping_differences),
    };
}

// Infer the original fixture date from the immutable Pool B users.
async function inferPerfSourceSeedDate(client) {
    const result = await client.query(`
        WITH session_unique_contract AS (
            SELECT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_constraint
                    AS constraint_record
                WHERE
                    constraint_record.conrelid =
                        'public.study_sessions'::regclass
                    AND constraint_record.contype = 'u'
                    AND ARRAY(
                        SELECT attribute.attname::text
                        FROM unnest(
                            constraint_record.conkey
                        ) WITH ORDINALITY
                            AS key_column(
                                attnum,
                                position
                            )
                        JOIN pg_catalog.pg_attribute
                            AS attribute
                            ON attribute.attrelid =
                                constraint_record.conrelid
                            AND attribute.attnum =
                                key_column.attnum
                        ORDER BY key_column.position
                    ) = ARRAY[
                        'user_id',
                        'studied_on'
                    ]::text[]
            ) AS user_date_unique
        ),

        pool_b_per_user AS (
            SELECT
                pu.seq,
                COUNT(s.id)::bigint
                    AS total_sessions,
                MIN(s.studied_on)
                    AS minimum_studied_on,
                MAX(s.studied_on)
                    AS maximum_studied_on
            FROM public.perf_users AS pu
            LEFT JOIN public.study_sessions AS s
                ON s.user_id = pu.user_id
            WHERE pu.seq BETWEEN $1 AND $2
            GROUP BY pu.seq
        ),

        pool_b_summary AS (
            SELECT
                COUNT(*)::bigint AS users,
                COALESCE(
                    SUM(total_sessions),
                    0
                )::bigint AS sessions,
                MIN(maximum_studied_on)
                    AS minimum_anchor_date,
                MAX(maximum_studied_on)
                    AS maximum_anchor_date,
                COUNT(*) FILTER (
                    WHERE total_sessions
                        IS DISTINCT FROM $4::bigint
                )::bigint
                    AS users_with_invalid_session_count,
                COUNT(*) FILTER (
                    WHERE
                        minimum_studied_on
                        IS DISTINCT FROM
                            maximum_studied_on
                            - $3::integer
                )::bigint
                    AS users_with_invalid_date_range
            FROM pool_b_per_user
        )

        SELECT
            CURRENT_DATE::text AS current_date,
            clock_timestamp()::date::text
                AS wall_date,
            session_unique_contract.user_date_unique,
            pool_b_summary.users,
            pool_b_summary.sessions,
            pool_b_summary.minimum_anchor_date::text
                AS minimum_anchor_date,
            pool_b_summary.maximum_anchor_date::text
                AS maximum_anchor_date,
            (
                pool_b_summary.maximum_anchor_date
                    IS NOT NULL
                AND pool_b_summary.maximum_anchor_date
                    <= CURRENT_DATE
            ) AS source_date_not_in_future,
            pool_b_summary
                .users_with_invalid_session_count,
            pool_b_summary
                .users_with_invalid_date_range
        FROM session_unique_contract
        CROSS JOIN pool_b_summary
    `, [
        POOLS.B.firstSeq,
        POOLS.B.lastSeq,
        HISTORY_DAYS,
        HISTORY_DAYS + 1,
    ]);

    const state = result.rows[0];

    const expectedPoolBSessions =
        POOLS.B.users * (HISTORY_DAYS + 1);

    if (
        !state ||
        state.current_date !== state.wall_date ||
        state.user_date_unique !== true ||
        Number(state.users) !== POOLS.B.users ||
        Number(state.sessions) !==
        expectedPoolBSessions ||
        !state.minimum_anchor_date ||
        state.minimum_anchor_date !==
        state.maximum_anchor_date ||
        state.source_date_not_in_future !== true ||
        Number(
            state.users_with_invalid_session_count
        ) !== 0 ||
        Number(
            state.users_with_invalid_date_range
        ) !== 0
    ) {
        throw new PerfSafetyError(
            "PERF source seed-date anchor checks failed"
        );
    }

    return {
        sourceSeedDate:
            state.maximum_anchor_date,
        currentDate: state.current_date,
        poolBUsers: Number(state.users),
        poolBSessions: Number(state.sessions),
        sessionUserDateUnique: true,
    };
}


// Define only; this function is not called yet.
// Reject partial, unexpected, or non-removable PERF mapping objects.
export async function inspectPerfMappingObjects(client) {
    const result = await client.query(`
        SELECT
            relation.relname AS relation_name,
            relation.relkind,

            CASE
                WHEN relation.relkind = 'r'
                THEN has_table_privilege(
                    current_user,
                    relation.oid,
                    'SELECT'
                )
                ELSE FALSE
            END AS can_select,

            (
                pg_has_role(
                    current_user,
                    relation.relowner,
                    'USAGE'
                )
                OR pg_has_role(
                    current_user,
                    namespace.nspowner,
                    'USAGE'
                )
                OR EXISTS (
                    SELECT 1
                    FROM pg_catalog.pg_roles AS role_record
                    WHERE
                        role_record.rolname = current_user
                        AND role_record.rolsuper
                )
            ) AS can_drop

        FROM pg_catalog.pg_class AS relation

        JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace

        WHERE
            namespace.nspname = 'public'
            AND relation.relname =
                ANY($1::text[])

        ORDER BY relation.relname
    `, [PERF_MAPPING_RELATIONS]);

    const objects = result.rows;

    if (
        objects.length !== 0 &&
        objects.length !== PERF_MAPPING_RELATIONS.length
    ) {
        throw new PerfSafetyError(
            "Only one PERF mapping object exists; refusing cleanup"
        );
    }

    const failures = [];

    for (const object of objects) {
        if (object.relkind !== "r") {
            failures.push(
                `${object.relation_name}:not-an-ordinary-table`
            );
        }

        if (!object.can_select) {
            failures.push(
                `${object.relation_name}:not-readable`
            );
        }

        if (!object.can_drop) {
            failures.push(
                `${object.relation_name}:not-removable`
            );
        }
    }

    if (failures.length > 0) {
        throw new PerfSafetyError(
            `PERF mapping checks failed: ${failures.join(", ")}`
        );
    }

    return {
        mappingState:
            objects.length === 0
                ? "absent"
                : "present",
        objectsFound: objects.length,
        ordinaryTables: objects.length,
        readableObjects: objects.length,
        removableObjects: objects.length,
    };
}

const APPROVED_INITIAL_DATASET = {
    users: 2,
    studySessions: 2,
    characters: 365,
};

// Define only; this function is not called yet.
// Accept only the manually approved first-seed staging snapshot.
export async function assertApprovedInitialDataset(client) {
    const mappings = await inspectPerfMappingObjects(client);

    if (mappings.mappingState !== "absent") {
        throw new PerfSafetyError(
            "Initial seed requires both PERF mapping tables to be absent"
        );
    }

    const result = await client.query(`
        SELECT
            (
                SELECT COUNT(*)
                FROM public.users
            )::bigint AS users,

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
                WHERE story_status = $1
            )::bigint AS generating_stories,

            (
                SELECT COUNT(*)
                FROM public.users
                WHERE email LIKE $2
            )::bigint AS synthetic_users
    `, [
        "generating",
        "%@perf.invalid",
    ]);

    const state = result.rows[0];

    if (
        Number(state.users) !==
        APPROVED_INITIAL_DATASET.users ||
        Number(state.study_sessions) !==
        APPROVED_INITIAL_DATASET.studySessions ||
        Number(state.characters) !==
        APPROVED_INITIAL_DATASET.characters
    ) {
        throw new PerfSafetyError(
            "Staging no longer matches the approved initial dataset"
        );
    }

    if (Number(state.generating_stories) !== 0) {
        throw new PerfSafetyError(
            "Story generation is currently in progress"
        );
    }

    if (Number(state.synthetic_users) !== 0) {
        throw new PerfSafetyError(
            "Unexpected synthetic users already exist"
        );
    }

    return {
        classification: "approved-initial-staging",
        users: Number(state.users),
        studySessions:
            Number(state.study_sessions),
        characters: Number(state.characters),
        generatingStories:
            Number(state.generating_stories),
        syntheticUsers:
            Number(state.synthetic_users),
        mappingState: mappings.mappingState,
    };
}

// Define only; this function is not called yet.
// Accept only a verified synthetic PERF dataset as a reseed source.
// Accept only a verified synthetic PERF dataset as a reseed source.
// Pool A may contain valid first-write rows from a completed load run.
export async function assertApprovedPerfSourceDataset(client) {
    const mappings = await inspectPerfMappingObjects(client);

    if (mappings.mappingState !== "present") { throw new PerfSafetyError("Repeat seed requires both PERF mapping tables"); }

    const columnContract = await assertPerfMappingColumnContract(client);

    const users = await assertPerfFixtureUsers(client);

    const characters = await assertPerfFixtureCharacters(client);

    const sourceAnchor = await inferPerfSourceSeedDate(client);

    const sessions = await inspectPerfSessionFacts(client, sourceAnchor.sourceSeedDate);

    const poolASessions = sessions.poolAFixtureDateSessions;

    const expectedFixtureDateSessions = TODAY_SESSIONS + poolASessions;

    const expectedTotalSessions = HISTORICAL_SESSIONS + expectedFixtureDateSessions;

    if (sessions.currentDate !== sessions.wallDate || sessions.fixtureDate > sessions.currentDate) {
        throw new PerfSafetyError("PERF source date is not compatible with the database clock");
    }

    if (!sessions.sessionUserDateUniqueConstraint) {
        throw new PerfSafetyError("The user and study-date uniqueness contract is missing");
    }

    if (
        sessions.historicalSessions !== HISTORICAL_SESSIONS ||
        sessions.fixtureDateSessions !== expectedFixtureDateSessions ||
        sessions.studySessions !== expectedTotalSessions
    ) {
        throw new PerfSafetyError("PERF source session totals are inconsistent");
    }

    if (
        poolASessions < 0 ||
        poolASessions > POOLS.A.users ||
        sessions.poolRFixtureDateSessions !== 0 ||
        sessions.poolBFixtureDateSessions !==
        TODAY_SESSIONS
    ) {
        throw new PerfSafetyError(
            "PERF source pool distribution is invalid"
        );
    }

    if (
        sessions.dateRange.minimum !== sessions.expectedDateRange.minimum ||
        sessions.dateRange.maximum !== sessions.expectedDateRange.maximum ||
        sessions.sessionsBeforeHistory !== 0 || sessions.sessionsAfterFixtureDate !== 0 ||
        sessions.sessionsOutsideDateRange !== 0
    ) {
        throw new PerfSafetyError(
            "PERF source contains sessions outside its fixture dates"
        );
    }

    if (
        sessions.unmappedUserSessions !== 0 || sessions.unmappedCharacterSessions !== 0
    ) {
        throw new PerfSafetyError(
            "PERF source contains unmapped session records"
        );
    }

    if (
        sessions.invalidHistoricalSessions !== 0 || sessions.invalidReseedFixtureDateSessions !== 0
    ) {
        throw new PerfSafetyError(
            "PERF source contains non-canonical session records"
        );
    }

    return {
        classification: "approved-perf-source",
        mappingState: mappings.mappingState,
        mappingColumnsChecked: columnContract.columnsChecked,
        users: users.users,
        userMappings: users.userMappings,
        userSequenceRange: users.userSequenceRange,
        distinctPasswordHashes: users.distinctPasswordHashes,
        invalidUsers: users.invalidUsers,
        characters: characters.characters,
        characterMappings: characters.characterMappings,
        characterSequenceRange: characters.characterSequenceRange,
        syntheticStories: characters.syntheticStories,
        invalidStories: characters.invalidStories,
        characterMappingDifferences: characters.mappingDifferences,
        sourceSeedDate: sourceAnchor.sourceSeedDate,
        currentDate: sessions.currentDate,
        dailyCharacterId: sessions.dailyCharacterId,
        studySessions: sessions.studySessions,
        historicalSessions: sessions.historicalSessions,
        fixtureDateSessions: sessions.fixtureDateSessions,
        poolAFixtureDateSessions: sessions.poolAFixtureDateSessions,
        poolBFixtureDateSessions: sessions.poolBFixtureDateSessions,
        sessionsOutsideDateRange: sessions.sessionsOutsideDateRange,
        invalidHistoricalSessions: sessions.invalidHistoricalSessions,
        invalidReseedFixtureDateSessions: sessions.invalidReseedFixtureDateSessions,
        sessionUserDateUnique: sessions.sessionUserDateUniqueConstraint,
        poolBAnchorUsers: sourceAnchor.poolBUsers,
        poolBAnchorSessions: sourceAnchor.poolBSessions,
    };
}


const APPROVED_SEED_SOURCE_CLASSIFICATIONS = new Set(["approved-initial-staging", "approved-perf-source"]);

// Return only stable fields that identify an approved source.
// Current clock values are intentionally excluded.
export function approvedSeedSourceIdentity(dataset) {
    if (dataset?.classification === "approved-initial-staging") {
        return {
            classification: dataset.classification,
            mappingState: dataset.mappingState,
            users: dataset.users,
            studySessions: dataset.studySessions,
            characters: dataset.characters,
        };
    }

    if (dataset?.classification === "approved-perf-source") {
        return {
            classification: dataset.classification,
            mappingState: dataset.mappingState,
            sourceSeedDate: dataset.sourceSeedDate,
            users: dataset.users,
            userMappings: dataset.userMappings,
            characters: dataset.characters,
            characterMappings: dataset.characterMappings,
            studySessions: dataset.studySessions,
            historicalSessions: dataset.historicalSessions,
            fixtureDateSessions: dataset.fixtureDateSessions,
            poolAFixtureDateSessions: dataset.poolAFixtureDateSessions,
            poolBFixtureDateSessions: dataset.poolBFixtureDateSessions,
            dailyCharacterId: dataset.dailyCharacterId,
        };
    }

    throw new PerfSafetyError("Seed source classification is not approved");
}

// Compare two validated sources without comparing transient clock fields.
export function approvedSeedSourcesMatch(expected, actual) {
    return JSON.stringify(approvedSeedSourceIdentity(expected)) === JSON.stringify(approvedSeedSourceIdentity(actual));
}

// Accept either the approved first-seed snapshot or a verified PERF fixture.
// Mapping-table presence selects exactly one validation policy.
export async function assertApprovedSeedSourceDataset(
    client,
    { expectedClassification = null } = {}
) {
    if (expectedClassification !== null && !APPROVED_SEED_SOURCE_CLASSIFICATIONS.has(expectedClassification)) {
        throw new PerfSafetyError("Unknown expected seed-source classification");
    }

    const mappings = await inspectPerfMappingObjects(client);

    const selectedClassification = mappings.mappingState === "absent" ? "approved-initial-staging" : "approved-perf-source";

    if (expectedClassification !== null && selectedClassification !== expectedClassification) {
        throw new PerfSafetyError("Seed-source confirmation does not match the current dataset type");
    }
    if (
        selectedClassification === "approved-initial-staging"
    ) {
        return assertApprovedInitialDataset(client);
    }
    return assertApprovedPerfSourceDataset(client);
}

