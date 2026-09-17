import { PerfSafetyError} from "./staging-guard.mjs";

// Capture counts and server-side fingerprints without returning row contents.
// Capture deterministic fingerprints without building one huge JSON array.
// Rows are hashed in groups of at most 10,000 IDs.
export async function captureCoreDatasetSnapshot(client) {
    const result = await client.query(`
        WITH user_row_hashes AS (
            SELECT
                u.id,
                u.id::bigint / 10000 AS bucket,
                md5(to_jsonb(u)::text) AS row_hash
            FROM public.users AS u
        ),

        user_chunks AS (
            SELECT
                bucket,
                COUNT(*)::bigint AS chunk_rows,
                md5(
                    string_agg(
                        row_hash,
                        ''
                        ORDER BY id
                    )
                ) AS chunk_hash
            FROM user_row_hashes
            GROUP BY bucket
        ),

        user_summary AS (
            SELECT
                COALESCE(
                    SUM(chunk_rows),
                    0
                )::bigint AS rows,
                md5(
                    COALESCE(
                        string_agg(
                            chunk_hash,
                            ''
                            ORDER BY bucket
                        ),
                        ''
                    )
                ) AS fingerprint
            FROM user_chunks
        ),

        session_row_hashes AS (
            SELECT
                s.id,
                s.id::bigint / 10000 AS bucket,
                md5(to_jsonb(s)::text) AS row_hash
            FROM public.study_sessions AS s
        ),

        session_chunks AS (
            SELECT
                bucket,
                COUNT(*)::bigint AS chunk_rows,
                md5(
                    string_agg(
                        row_hash,
                        ''
                        ORDER BY id
                    )
                ) AS chunk_hash
            FROM session_row_hashes
            GROUP BY bucket
        ),

        session_summary AS (
            SELECT
                COALESCE(
                    SUM(chunk_rows),
                    0
                )::bigint AS rows,
                md5(
                    COALESCE(
                        string_agg(
                            chunk_hash,
                            ''
                            ORDER BY bucket
                        ),
                        ''
                    )
                ) AS fingerprint
            FROM session_chunks
        ),

        character_row_hashes AS (
            SELECT
                c.id,
                c.id::bigint / 10000 AS bucket,
                md5(to_jsonb(c)::text) AS row_hash
            FROM public.characters AS c
        ),

        character_chunks AS (
            SELECT
                bucket,
                COUNT(*)::bigint AS chunk_rows,
                md5(
                    string_agg(
                        row_hash,
                        ''
                        ORDER BY id
                    )
                ) AS chunk_hash
            FROM character_row_hashes
            GROUP BY bucket
        ),

        character_summary AS (
            SELECT
                COALESCE(
                    SUM(chunk_rows),
                    0
                )::bigint AS rows,
                md5(
                    COALESCE(
                        string_agg(
                            chunk_hash,
                            ''
                            ORDER BY bucket
                        ),
                        ''
                    )
                ) AS fingerprint
            FROM character_chunks
        )

        SELECT
            users.rows AS users,
            sessions.rows AS study_sessions,
            characters.rows AS characters,
            users.fingerprint AS users_fingerprint,
            sessions.fingerprint AS sessions_fingerprint,
            characters.fingerprint AS characters_fingerprint
        FROM user_summary AS users
        CROSS JOIN session_summary AS sessions
        CROSS JOIN character_summary AS characters
    `);

    const state = result.rows[0];

    if (!state) {
        throw new PerfSafetyError(
            "Core dataset snapshot returned no result"
        );
    }

    return {
        users: Number(state.users),
        studySessions: Number(state.study_sessions),
        characters: Number(state.characters),
        usersFingerprint: state.users_fingerprint,
        sessionsFingerprint: state.sessions_fingerprint,
        charactersFingerprint: state.characters_fingerprint,
    };
}

// Compare snapshots without exposing any of their fingerprints.
export function coreSnapshotsMatch(expected, actual) {
    return (
        expected.users === actual.users &&
        expected.studySessions === actual.studySessions &&
        expected.characters === actual.characters &&
        expected.usersFingerprint === actual.usersFingerprint &&
        expected.sessionsFingerprint === actual.sessionsFingerprint &&
        expected.charactersFingerprint ===
        actual.charactersFingerprint
    );
}