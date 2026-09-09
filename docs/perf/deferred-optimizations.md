# Deferred Performance Optimizations

This file records performance candidates that are intentionally deferred until
M3 so that Chinstein can establish a reproducible baseline before optimization.

Correctness, security, and data-integrity fixes in M1 are still allowed. If a
concurrency fix requires changing `createSession()`, make only the change needed
for correctness and record it here. Do not combine queries or tune the
connection pool without measurement.

## Candidates

### Repeated profile calculation in `createSession()`

The current request path makes approximately five database query calls:

1. Load the user profile before the session.
2. Load the submitted character.
3. Load today's character.
4. Insert the study session.
5. Load the user profile after the session.

The two profile calls execute the full `PROFILE_SQL`. Measure their contribution
before deciding whether to combine queries, return less data, or calculate badge
changes another way.

### PostgreSQL connection pool

`server/src/db.ts` does not explicitly configure `pg.Pool.max`. Record the
effective pool configuration during the baseline and observe pool waiting,
request latency, and database utilization before changing it.

### `study_sessions.character_id` index

There is no standalone index on `study_sessions.character_id`. Current profile
queries primarily filter by `user_id`, and the existing index begins with
`user_id`. Add another index only if a measured query plan needs it.

### Random character options

The quiz option query uses `ORDER BY RANDOM()`. The characters table currently
contains only a few hundred rows, so this is not assumed to be a bottleneck.
Revisit it only if measurements or future dataset growth justify a change.

## Experiment rule

Choose the M3 optimization from measured evidence such as k6 results,
`EXPLAIN (ANALYZE, BUFFERS)`, CloudWatch metrics, Neon metrics, or connection
pool observations. Do not claim a bottleneck or improvement before collecting
the baseline.