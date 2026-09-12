# Deferred Performance Optimizations

This file records performance candidates that are intentionally deferred until
M3 so that Chinstein can establish a reproducible baseline before optimization.

Correctness, security, and data-integrity fixes in M1 are still allowed. If a
concurrency fix requires changing `createSession()`, make only the change needed
for correctness and record it here. Do not combine queries or tune the
connection pool without measurement.

## Candidates

### Keep story generation out of the core baseline

`GET /api/characters/today` can synchronously generate a missing story through
an external model. That cold path has a seconds-scale latency budget, retries,
provider rate limits, and a separate usage cost. Mixing it into the main API
benchmark would make ECS, PostgreSQL, and external-model latency impossible to
distinguish.

Before the core baseline, seed every character that the benchmark can select
with fixed-size synthetic story text and set `story_status = 'ready'`. This
stabilizes response size and establishes the following invariant:

> Anthropic call count during the core performance run is zero.

Measure story generation as a separate, low-volume integration experiment. It
should cover one cold generation, concurrent claim suppression, fallback for
losing requests, the application deadline, provider errors, rate limiting, and
cache-hit latency. Record provider-call count and estimated cost alongside the
latency result.

The story-resilience work in A4.1 is a correctness and cost-control prerequisite,
not a performance optimization. Its attempt budget, terminal `failed` state,
stale-claim recovery, and generation-disabled guard may be implemented before
the baseline without violating this document's experiment rule.

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

### Leaderboard aggregation

`GET /api/leaderboard` currently aggregates all studied users and calculates
`RANK()` and `ROW_NUMBER()` on every request. M1.5 intentionally adds no
leaderboard-specific cache, materialized view, or index before measuring a
baseline.

Use this endpoint as the global aggregation read scenario in M3, alongside the
per-user `GET /api/me` scenario. Seed only synthetic display names such as
`player_00042`; do not derive names from email addresses or use real user data.

Measure query plans, latency, response size, database utilization, and cache
tradeoffs before choosing an optimization.

## Experiment rule

Choose the M3 optimization from measured evidence such as k6 results,
`EXPLAIN (ANALYZE, BUFFERS)`, CloudWatch metrics, Neon metrics, or connection
pool observations. Do not claim a bottleneck or improvement before collecting
the baseline.
